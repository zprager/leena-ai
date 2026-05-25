/**
 * Calibration sweep — runs the eval N times across a range of threshold
 * values and picks the one that minimizes weighted error.
 *
 * Design notes:
 *  - Threshold is plumbed through `runEval` → `triage` → `retrieve` so we can
 *    vary it per run without mutating process.env or restarting the process.
 *  - Sweeps are streamed (sweep-start → per-run events → sweep-complete) so
 *    the UI can fill in the comparison table live. NDJSON over POST.
 *  - "Best" is whatever minimizes weighted error. Tie-break: the higher
 *    threshold (more cautious — fewer false_resolves when models drift).
 */
import { loadEvalSet, DEFAULT_EVAL_SET_PATH } from "./dataset";
import { runEval } from "./run";
import type { EvalReport, EvalTicket, ScoredResult } from "./types";

export interface SweepRunResult {
  threshold: number;
  durationMs: number;
  report: EvalReport;
}

export interface SweepBest {
  threshold: number;
  weightedError: number;
  normalizedScore: number;
}

export interface StoredSweep {
  sweepId: string;
  runAt: string; // ISO
  description?: string;
  parameter: "RETRIEVAL_SCORE_THRESHOLD";
  values: number[];
  options: { multiQuery: boolean; concurrency: number };
  runs: SweepRunResult[];
  best: SweepBest;
  /** Total wall-clock time across all runs in this sweep. */
  totalDurationMs: number;
}

export type SweepEvent =
  | {
      type: "sweep-start";
      sweepId: string;
      values: number[];
      options: { multiQuery: boolean; concurrency: number };
      ticketCount: number;
    }
  | { type: "run-start"; threshold: number; index: number; total: number }
  | {
      type: "run-progress";
      threshold: number;
      completed: number;
      total: number;
      result: ScoredResult;
    }
  | { type: "run-complete"; threshold: number; run: SweepRunResult }
  | { type: "sweep-complete"; sweep: StoredSweep }
  | { type: "error"; threshold?: number; message: string };

export interface SweepOptions {
  thresholds: number[];
  multiQuery?: boolean;
  concurrency?: number;
  description?: string;
  /** Override the dataset file (default: fixtures/eval-50.json). */
  datasetPath?: string;
  /** Stream callback for live UI / CLI progress. */
  onEvent?: (event: SweepEvent) => void;
}

/**
 * Generate a sortable, filesystem-safe sweep id from the current timestamp.
 * Lexicographic sort == chronological, so `ls -1 reports/sweeps/` shows
 * the history in order without needing a separate index.
 */
export function generateSweepId(now: Date = new Date()): string {
  return "sweep-" + now.toISOString().replace(/[:.]/g, "-").replace(/Z$/, "Z");
}

/**
 * Run an eval at every threshold in `opts.thresholds`, sequentially. Within
 * each run, tickets are dispatched with the configured concurrency.
 *
 * We run thresholds SEQUENTIALLY (not in parallel) on purpose — the embedding
 * results are identical regardless of threshold, but parallelizing 6× the
 * load on the LLM provider would more than triple wall-time once rate limits
 * kick in. One run at a time is the right shape.
 */
export async function runSweep(opts: SweepOptions): Promise<StoredSweep> {
  const sweepId = generateSweepId();
  const runAt = new Date().toISOString();
  const multiQuery = opts.multiQuery ?? false;
  const concurrency = opts.concurrency ?? 5;
  const datasetPath = opts.datasetPath ?? DEFAULT_EVAL_SET_PATH;
  const emit = opts.onEvent ?? (() => {});

  // Sort + dedup so the UI sees a deterministic value order regardless of how
  // the caller built the list (e.g. `0.5,0.3,0.4` becomes [0.3, 0.4, 0.5]).
  const values = Array.from(new Set(opts.thresholds))
    .filter((v) => v >= 0 && v <= 1)
    .sort((a, b) => a - b);
  if (values.length === 0) throw new Error("sweep requires at least one threshold in [0,1]");

  // Load the dataset once and reuse across runs — saves disk + parse work.
  let tickets: EvalTicket[];
  try {
    tickets = await loadEvalSet(datasetPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ type: "error", message: `Failed to load eval set: ${message}` });
    throw err;
  }

  emit({
    type: "sweep-start",
    sweepId,
    values,
    options: { multiQuery, concurrency },
    ticketCount: tickets.length,
  });

  const runs: SweepRunResult[] = [];
  let totalDurationMs = 0;

  for (let i = 0; i < values.length; i++) {
    const threshold = values[i];
    emit({ type: "run-start", threshold, index: i, total: values.length });

    const runStart = Date.now();
    try {
      const report = await runEval(tickets, {
        multiQuery,
        concurrency,
        scoreThreshold: threshold,
        onProgress: (completed, total, result) => {
          emit({ type: "run-progress", threshold, completed, total, result });
        },
      });
      const durationMs = Date.now() - runStart;
      totalDurationMs += durationMs;
      const run: SweepRunResult = { threshold, durationMs, report };
      runs.push(run);
      emit({ type: "run-complete", threshold, run });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emit({ type: "error", threshold, message });
      // Don't bail the whole sweep on a single threshold failure; record what
      // we have and continue. The UI will surface the gap.
    }
  }

  if (runs.length === 0) {
    throw new Error("All sweep runs failed — nothing to summarize");
  }

  const best = pickBest(runs);
  const sweep: StoredSweep = {
    sweepId,
    runAt,
    description: opts.description,
    parameter: "RETRIEVAL_SCORE_THRESHOLD",
    values,
    options: { multiQuery, concurrency },
    runs,
    best,
    totalDurationMs,
  };

  emit({ type: "sweep-complete", sweep });
  return sweep;
}

/**
 * Winner = lowest weighted error. Tie-break by HIGHER threshold (more
 * cautious — preserves restraint margin when model behavior drifts).
 */
export function pickBest(runs: SweepRunResult[]): SweepBest {
  const sorted = [...runs].sort((a, b) => {
    const eDiff = a.report.weightedError - b.report.weightedError;
    if (eDiff !== 0) return eDiff;
    return b.threshold - a.threshold; // tie-break: higher threshold wins
  });
  const winner = sorted[0];
  return {
    threshold: winner.threshold,
    weightedError: winner.report.weightedError,
    normalizedScore: winner.report.normalizedScore,
  };
}

/**
 * Parse a CLI threshold list — either comma-separated values or a
 * start:end:step shorthand.
 *
 *   "0.30,0.40,0.50"   → [0.30, 0.40, 0.50]
 *   "0.30:0.55:0.05"   → [0.30, 0.35, 0.40, 0.45, 0.50, 0.55]
 */
export function parseThresholds(spec: string): number[] {
  const trimmed = spec.trim();
  if (trimmed.includes(":")) {
    const parts = trimmed.split(":").map((p) => Number(p.trim()));
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
      throw new Error(`bad threshold range "${spec}" — expected start:end:step`);
    }
    const [start, end, step] = parts;
    if (step <= 0 || end < start) throw new Error(`bad threshold range "${spec}"`);
    const out: number[] = [];
    // Use rounded comparison so floating-point drift doesn't drop the endpoint.
    for (let v = start; v <= end + 1e-9; v += step) {
      out.push(Math.round(v * 1000) / 1000);
    }
    return out;
  }
  return trimmed
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
}
