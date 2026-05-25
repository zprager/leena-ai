import type { ReasonCode } from "@/lib/agent";
import type { TriageResult } from "@/lib/agent";

/**
 * One ticket in the eval dataset. The body is exactly what gets passed to
 * `triage()` — what the assignment doc shows as the "Ticket Body" column.
 *
 * Ground truth is shaped per action:
 *  - RESOLVE → one or more acceptable citations (T-019 has two: POL-08 §8.3
 *              and POL-09 §9.6). Any one of them counts as a correct citation.
 *  - DEFER   → the expected reason code from the 12-code vocabulary.
 *
 * `note` is the human-readable explanation from the assignment, surfaced in
 * the report when a ticket fails so the reviewer can see what was expected.
 */
export type EvalGroundTruth =
  | { action: "RESOLVE"; citations: string[]; note: string }
  | { action: "DEFER"; reasonCode: ReasonCode; note: string };

export interface EvalTicket {
  id: string; // "T-001"
  body: string;
  groundTruth: EvalGroundTruth;
}

/**
 * Per-ticket scoring bucket. Six mutually exclusive categories that, together
 * with the 3× false-positive weighting, give us the full picture the rubric
 * grades against.
 *
 * - correct_resolve         → RESOLVE + citation in the expected set
 * - wrong_citation_resolve  → RESOLVE but cited a section not in the expected set
 *                              (the agent engaged but cited wrong — half credit)
 * - missed_resolve          → should RESOLVE but the agent DEFERRED (over-cautious)
 * - correct_defer           → DEFER + the right reason code
 * - wrong_reason_defer      → DEFER but with a wrong reason code (still better
 *                              than resolving — half credit)
 * - false_resolve           → should DEFER but the agent RESOLVED — the big sin,
 *                              weighted 3× in the aggregate
 */
export type ScoringBucket =
  | "correct_resolve"
  | "wrong_citation_resolve"
  | "missed_resolve"
  | "correct_defer"
  | "wrong_reason_defer"
  | "false_resolve";

export interface ScoredResult {
  ticket: EvalTicket;
  result: TriageResult;
  bucket: ScoringBucket;
  /** Numeric error contribution (used by the weighted aggregate). */
  errorWeight: number;
}

/**
 * Per-reason-code precision/recall. We compute this for the 12 DEFER codes so
 * we can spot e.g. "agent over-uses LOW_CONFIDENCE" or "PROMPT_INJECTION
 * recall is 1.0 but ACTIVE_INCIDENT recall is 0.67".
 */
export interface ReasonCodeStats {
  code: ReasonCode;
  /** Tickets where ground truth is this code. */
  support: number;
  /** Tickets the agent predicted as this code. */
  predicted: number;
  /** Predicted as this code AND ground truth is this code. */
  truePositives: number;
  precision: number; // truePositives / predicted
  recall: number; // truePositives / support
}

export interface EvalReport {
  totals: {
    n: number;
    correct: number; // correct_resolve + correct_defer
    durationMsTotal: number;
    durationMsAvg: number;
  };
  buckets: Record<ScoringBucket, number>;
  /**
   * Aggregate weighted error: sum of per-ticket errorWeight values.
   * Lower is better. false_resolve contributes 3× a missed_resolve.
   */
  weightedError: number;
  /** weightedError divided by the maximum possible (n * 3.0), as a 0..1 score. */
  normalizedScore: number; // 1.0 = perfect, 0.0 = every ticket maxed out
  reasonCodeStats: ReasonCodeStats[];
  /** Subset that fired the grounding/threshold downgrade. */
  downgradedCount: number;
  results: ScoredResult[];
}

export interface RunEvalOptions {
  multiQuery?: boolean;
  /** Max parallel triage calls. Default 5 — both providers handle that fine. */
  concurrency?: number;
  /**
   * Override the threshold the post-validation guard uses to detect "weak"
   * retrieval. Passed through to triage(). The sweep harness varies this
   * across runs to find the value that minimizes weighted error.
   */
  scoreThreshold?: number;
  /** Optional progress callback (e.g. for CLI spinner). */
  onProgress?: (completed: number, total: number, latest: ScoredResult) => void;
}
