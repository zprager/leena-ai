import { REASON_CODES, type ReasonCode } from "@/lib/agent";
import type { TriageResult } from "@/lib/agent";
import type {
  EvalReport,
  EvalTicket,
  ReasonCodeStats,
  ScoredResult,
  ScoringBucket,
} from "./types";

/**
 * Error weights per bucket.
 *
 * The rubric says false-positive RESOLVE is weighted ~3× a missed RESOLVE.
 * `correct_*` is zero. We give half-credit to the "right intent, wrong
 * detail" buckets (wrong_citation_resolve, wrong_reason_defer) — the agent
 * made the correct directional call but missed the specifics.
 */
const ERROR_WEIGHTS: Record<ScoringBucket, number> = {
  correct_resolve: 0,
  wrong_citation_resolve: 0.5,
  missed_resolve: 1.0,
  correct_defer: 0,
  wrong_reason_defer: 0.5,
  false_resolve: 3.0, // the asymmetric penalty from the rubric
};

/** Maximum per-ticket error; used to normalize the aggregate to a 0..1 score. */
const MAX_ERROR_PER_TICKET = 3.0;

/** Bucket a single triage result against its ground truth. */
export function scoreTicket(
  ticket: EvalTicket,
  result: TriageResult,
): ScoredResult {
  const gt = ticket.groundTruth;
  const dec = result.decision;

  let bucket: ScoringBucket;
  if (gt.action === "RESOLVE") {
    if (dec.action === "RESOLVE") {
      bucket = gt.citations.includes(dec.citation)
        ? "correct_resolve"
        : "wrong_citation_resolve";
    } else {
      bucket = "missed_resolve";
    }
  } else {
    // gt.action === "DEFER"
    if (dec.action === "DEFER") {
      bucket = dec.reasonCode === gt.reasonCode ? "correct_defer" : "wrong_reason_defer";
    } else {
      bucket = "false_resolve";
    }
  }

  return {
    ticket,
    result,
    bucket,
    errorWeight: ERROR_WEIGHTS[bucket],
  };
}

/**
 * Per-reason-code precision / recall over the DEFER tickets. We compute this
 * across all 12 codes including ones with zero support — that makes the
 * report comparable across runs even if a code didn't appear in this dataset.
 */
function computeReasonCodeStats(results: ScoredResult[]): ReasonCodeStats[] {
  return REASON_CODES.map<ReasonCodeStats>((code) => {
    let support = 0;
    let predicted = 0;
    let tp = 0;
    for (const r of results) {
      const isGt = r.ticket.groundTruth.action === "DEFER" && r.ticket.groundTruth.reasonCode === code;
      const isPred = r.result.decision.action === "DEFER" && r.result.decision.reasonCode === code;
      if (isGt) support += 1;
      if (isPred) predicted += 1;
      if (isGt && isPred) tp += 1;
    }
    return {
      code,
      support,
      predicted,
      truePositives: tp,
      precision: predicted > 0 ? tp / predicted : 0,
      recall: support > 0 ? tp / support : 0,
    };
  });
}

/**
 * Roll a list of per-ticket ScoredResults into the report shape the CLI and
 * any UI consume. Pure — no IO.
 */
export function aggregate(results: ScoredResult[]): EvalReport {
  const buckets: Record<ScoringBucket, number> = {
    correct_resolve: 0,
    wrong_citation_resolve: 0,
    missed_resolve: 0,
    correct_defer: 0,
    wrong_reason_defer: 0,
    false_resolve: 0,
  };

  let weightedError = 0;
  let durationMsTotal = 0;
  let downgradedCount = 0;

  for (const r of results) {
    buckets[r.bucket] += 1;
    weightedError += r.errorWeight;
    durationMsTotal += r.result.trace.durationMs;
    if (r.result.trace.downgraded) downgradedCount += 1;
  }

  const n = results.length;
  const correct = buckets.correct_resolve + buckets.correct_defer;
  const worstError = n * MAX_ERROR_PER_TICKET;

  return {
    totals: {
      n,
      correct,
      durationMsTotal,
      durationMsAvg: n > 0 ? Math.round(durationMsTotal / n) : 0,
    },
    buckets,
    weightedError,
    normalizedScore: worstError > 0 ? 1 - weightedError / worstError : 0,
    reasonCodeStats: computeReasonCodeStats(results),
    downgradedCount,
    results,
  };
}

/** Convenience: turn ground truth into the "citation OR reason" string for reports. */
export function groundTruthToString(gt: EvalTicket["groundTruth"]): string {
  if (gt.action === "RESOLVE") return gt.citations.join(" / ");
  return gt.reasonCode;
}

/** Convenience: same for a prediction. */
export function predictionToString(dec: TriageResult["decision"]): string {
  return dec.action === "RESOLVE" ? dec.citation : dec.reasonCode;
}

/** Quick lookup table for ReasonCode (unused outside reports but exported for symmetry). */
export type { ReasonCode };
