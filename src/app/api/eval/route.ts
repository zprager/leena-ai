/**
 * /api/eval — eval harness over HTTP.
 *
 *   GET                      → { lastRun: StoredEvalRun | null }
 *   POST { multiQuery, concurrency }
 *     → streamed NDJSON, one event per line:
 *         { type: "start",    total, ticketIds, options }
 *         { type: "progress", completed, total, result: ScoredResult }   (×N)
 *         { type: "complete", run: StoredEvalRun }
 *         { type: "error",    message }
 *
 * Why streaming: 50 LLM calls with default concurrency = 5 takes ~30s;
 * with --multi-query closer to 60s. Without streaming the page is a
 * blank spinner that whole time. NDJSON over POST is the simplest
 * client-readable variant (vs. SSE which is GET-flavored) — the client
 * uses `response.body.getReader()` and splits on newlines.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { DEFAULT_EVAL_SET_PATH, loadEvalSet, runEval } from "@/lib/eval";
import { getLastEvalRun, setLastEvalRun } from "@/lib/eval-store";

export const dynamic = "force-dynamic";
// 5 minutes. Vercel/Next will kill long-running route handlers without this;
// local `next dev` has no enforced limit but the hint documents intent.
export const maxDuration = 300;

export async function GET() {
  return NextResponse.json({ lastRun: getLastEvalRun() });
}

interface PostBody {
  multiQuery?: boolean;
  concurrency?: number;
}

export async function POST(req: NextRequest) {
  let body: PostBody = {};
  try {
    body = (await req.json()) as PostBody;
  } catch {
    // empty body is fine — defaults below kick in
  }

  const multiQuery = body.multiQuery === true;
  const concurrency =
    typeof body.concurrency === "number" && body.concurrency > 0 && body.concurrency <= 20
      ? Math.floor(body.concurrency)
      : 5;

  let tickets;
  try {
    tickets = await loadEvalSet(DEFAULT_EVAL_SET_PATH);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Failed to load eval set: ${message}` }, { status: 500 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      function emit(event: unknown) {
        if (closed) return;
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      }

      emit({
        type: "start",
        total: tickets.length,
        ticketIds: tickets.map((t) => t.id),
        options: { multiQuery, concurrency },
      });

      try {
        const report = await runEval(tickets, {
          multiQuery,
          concurrency,
          onProgress: (completed, total, latest) => {
            emit({ type: "progress", completed, total, result: latest });
          },
        });
        const stored: import("@/lib/eval-store").StoredEvalRun = {
          runAt: new Date().toISOString(),
          options: { multiQuery, concurrency },
          report,
        };
        setLastEvalRun(stored);
        emit({ type: "complete", run: stored });
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
      // Hint to upstream proxies (nginx, etc.) to flush instead of buffering.
      "X-Accel-Buffering": "no",
    },
  });
}
