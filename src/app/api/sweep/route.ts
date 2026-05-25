/**
 * /api/sweep — list + start sweeps.
 *
 *   GET                      → { sweeps: SweepMetadata[] }
 *   POST { thresholds, multiQuery, concurrency, description }
 *     → streamed NDJSON, one event per line:
 *         { type: "sweep-start",   sweepId, values, options, ticketCount }
 *         { type: "run-start",     threshold, index, total }
 *         { type: "run-progress",  threshold, completed, total, result }      (×N×R)
 *         { type: "run-complete",  threshold, run }                            (×R)
 *         { type: "sweep-complete", sweep }
 *         { type: "error",         threshold?, message }
 *
 * Persistence: every successful sweep is written to reports/sweeps/<id>.json
 * before the `sweep-complete` event fires, so the client can immediately
 * load it back via /api/sweep/[id] for permalinking.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { parseThresholds, runSweep } from "@/lib/eval";
import { listSweeps, saveSweep } from "@/lib/sweep-store";

export const dynamic = "force-dynamic";
// Sweeps are long-running by design — six runs at ~30s each = ~3 minutes.
// Without this, Vercel kills the function after 10s.
export const maxDuration = 900;

export async function GET() {
  const sweeps = await listSweeps();
  return NextResponse.json({ sweeps });
}

interface PostBody {
  /** Either an array of numbers or a string spec ("0.30:0.55:0.05" / "0.3,0.4,0.5"). */
  thresholds?: number[] | string;
  multiQuery?: boolean;
  concurrency?: number;
  description?: string;
}

export async function POST(req: NextRequest) {
  let body: PostBody = {};
  try {
    body = (await req.json()) as PostBody;
  } catch {
    // empty body → defaults below
  }

  let thresholds: number[];
  try {
    if (Array.isArray(body.thresholds)) {
      thresholds = body.thresholds.filter((n) => Number.isFinite(n));
    } else if (typeof body.thresholds === "string") {
      thresholds = parseThresholds(body.thresholds);
    } else {
      thresholds = parseThresholds("0.30:0.55:0.05");
    }
  } catch (err) {
    return NextResponse.json(
      { error: `Invalid thresholds: ${err instanceof Error ? err.message : String(err)}` },
      { status: 400 },
    );
  }
  if (thresholds.length === 0) {
    return NextResponse.json({ error: "thresholds list is empty" }, { status: 400 });
  }

  const multiQuery = body.multiQuery === true;
  const concurrency =
    typeof body.concurrency === "number" && body.concurrency > 0 && body.concurrency <= 20
      ? Math.floor(body.concurrency)
      : 5;
  const description = typeof body.description === "string" ? body.description : undefined;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      function emit(event: unknown) {
        if (closed) return;
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      }

      try {
        const sweep = await runSweep({
          thresholds,
          multiQuery,
          concurrency,
          description,
          onEvent: emit,
        });
        // Persist BEFORE the final event fires so the client can immediately
        // GET /api/sweep/[id] on the sweepId from sweep-complete.
        await saveSweep(sweep);
      } catch (err) {
        emit({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
