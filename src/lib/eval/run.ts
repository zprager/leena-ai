import { triage } from "@/lib/agent";
import { scoreTicket, aggregate } from "./metrics";
import type { EvalReport, EvalTicket, RunEvalOptions, ScoredResult } from "./types";

/**
 * Bounded-concurrency runner. We dispatch up to `concurrency` triage calls in
 * flight at once; each completion starts the next ticket. Results come back
 * in the order the tickets complete, but we sort by `id` before returning so
 * the final report is stable across runs at a given concurrency.
 *
 * Failure in one ticket does NOT sink the batch — we record a synthetic
 * scored result so the report still has a row for every input.
 */
export async function runEval(
  tickets: EvalTicket[],
  opts: RunEvalOptions = {},
): Promise<EvalReport> {
  const { multiQuery = false, concurrency = 5, scoreThreshold, onProgress } = opts;
  const total = tickets.length;
  const scored: ScoredResult[] = [];

  let nextIndex = 0;
  let completed = 0;

  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= total) return;
      const ticket = tickets[i];
      let result: ScoredResult;
      try {
        const triageResult = await triage(ticket.body, { multiQuery, scoreThreshold });
        result = scoreTicket(ticket, triageResult);
      } catch (err) {
        // Treat a failed triage as a missed_resolve / false_resolve depending
        // on ground truth — both signal "agent didn't function". The error
        // surfaces in the report via the synthetic decision/reasoning.
        result = scoreTicket(ticket, {
          decision: {
            action: "DEFER",
            reasonCode: "LOW_CONFIDENCE",
            note: `Triage error: ${err instanceof Error ? err.message : String(err)}`,
            reasoning: "Triage threw — see note.",
          },
          trace: {
            retrieval: {
              query: ticket.body,
              queriesUsed: [ticket.body],
              hits: [],
              topScore: 0,
              belowThreshold: true,
              contextBlock: "",
            },
            rawOutput: {
              // Schema now requires every field be present (nullable when
              // action-irrelevant) for OpenAI strict-mode compatibility —
              // mirror that here so the synthetic row stays type-valid.
              action: "DEFER",
              citation: null,
              answer: null,
              reasonCode: "LOW_CONFIDENCE",
              note: "error",
              reasoning: "error",
            },
            downgraded: null,
            durationMs: 0,
          },
        });
      }
      scored.push(result);
      completed += 1;
      onProgress?.(completed, total, result);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, total));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  // Stable ordering for reports — sort by id so eval.csv is deterministic.
  scored.sort((a, b) => a.ticket.id.localeCompare(b.ticket.id, "en", { numeric: true }));
  return aggregate(scored);
}
