import { groundTruthToString, predictionToString } from "./metrics";
import type { EvalReport, ScoredResult } from "./types";

/** Escape a CSV cell (quotes, commas, newlines, embedded quotes). */
function csvCell(s: string): string {
  if (s === "") return "";
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * The rubric-required deliverable: one row per ticket showing predicted
 * action + citation/reason vs. ground truth, plus a verdict column.
 *
 * Columns are stable so this CSV can be diffed across runs to see exactly
 * which tickets moved between buckets when you change the threshold or model.
 */
export function toCsv(report: EvalReport): string {
  const header = [
    "id",
    "gt_action",
    "gt_citation_or_reason",
    "pred_action",
    "pred_citation_or_reason",
    "bucket",
    "error_weight",
    "downgraded",
    "top_score",
    "duration_ms",
    "reasoning",
  ];
  const lines: string[] = [header.join(",")];

  for (const r of report.results) {
    const row = [
      r.ticket.id,
      r.ticket.groundTruth.action,
      groundTruthToString(r.ticket.groundTruth),
      r.result.decision.action,
      predictionToString(r.result.decision),
      r.bucket,
      String(r.errorWeight),
      r.result.trace.downgraded?.reason ?? "",
      r.result.trace.retrieval.topScore.toFixed(3),
      String(r.result.trace.durationMs),
      r.result.decision.reasoning,
    ].map((v) => csvCell(String(v)));
    lines.push(row.join(","));
  }

  return lines.join("\n");
}

/**
 * Human-readable summary — designed to paste into the assignment's eval
 * report section. Shows the headline numbers, bucket breakdown, per-reason-
 * code precision/recall, and a "failures of note" section that surfaces the
 * tickets a reviewer should look at first.
 */
export function toMarkdown(report: EvalReport): string {
  const t = report.totals;
  const b = report.buckets;
  const acc = t.n > 0 ? ((t.correct / t.n) * 100).toFixed(1) : "0.0";
  const score = (report.normalizedScore * 100).toFixed(1);

  const lines: string[] = [];
  lines.push("# Eval report — 50-ticket sample set");
  lines.push("");
  lines.push("## Headline");
  lines.push("");
  lines.push(`- **Strict accuracy:** ${t.correct}/${t.n} (${acc}%) — correct action + exact citation / reason code`);
  lines.push(
    `- **Weighted score:** ${score}% (1.0 = perfect; false-positive RESOLVE penalized 3× per the rubric)`,
  );
  lines.push(`- **Mean triage latency:** ${t.durationMsAvg}ms  (total: ${t.durationMsTotal}ms across ${t.n} tickets)`);
  lines.push(`- **Grounding/threshold downgrades fired:** ${report.downgradedCount}`);
  lines.push("");
  lines.push("## Scoring buckets");
  lines.push("");
  lines.push("| Bucket | Count | Error weight | What it means |");
  lines.push("|---|---:|---:|---|");
  lines.push(`| correct_resolve | ${b.correct_resolve} | 0 | RESOLVE + cited an expected section |`);
  lines.push(`| wrong_citation_resolve | ${b.wrong_citation_resolve} | 0.5 | RESOLVE but cited a different section |`);
  lines.push(`| missed_resolve | ${b.missed_resolve} | 1.0 | should RESOLVE; agent DEFERRED (over-cautious) |`);
  lines.push(`| correct_defer | ${b.correct_defer} | 0 | DEFER + correct reason code |`);
  lines.push(`| wrong_reason_defer | ${b.wrong_reason_defer} | 0.5 | DEFER but with a different reason code |`);
  lines.push(`| **false_resolve** | **${b.false_resolve}** | **3.0** | **should DEFER; agent RESOLVED (worst case)** |`);
  lines.push("");
  lines.push("## Per-reason-code precision / recall");
  lines.push("");
  lines.push("| Reason code | Support | Predicted | TP | Precision | Recall |");
  lines.push("|---|---:|---:|---:|---:|---:|");
  for (const s of report.reasonCodeStats) {
    if (s.support === 0 && s.predicted === 0) continue; // skip noise rows
    lines.push(
      `| ${s.code} | ${s.support} | ${s.predicted} | ${s.truePositives} | ${s.precision.toFixed(2)} | ${s.recall.toFixed(2)} |`,
    );
  }
  lines.push("");

  const failures = report.results.filter(
    (r) =>
      r.bucket === "false_resolve" ||
      r.bucket === "missed_resolve" ||
      r.bucket === "wrong_reason_defer" ||
      r.bucket === "wrong_citation_resolve",
  );
  if (failures.length > 0) {
    lines.push("## Failures of note");
    lines.push("");
    lines.push("Tickets where the agent didn't fully match ground truth, ordered by error weight then id.");
    lines.push("");
    lines.push("| ID | Bucket | Ground truth | Predicted | Why |");
    lines.push("|---|---|---|---|---|");
    failures
      .sort((a, b) => b.errorWeight - a.errorWeight || a.ticket.id.localeCompare(b.ticket.id, "en", { numeric: true }))
      .forEach((r) => {
        const gt = groundTruthToString(r.ticket.groundTruth);
        const pred = `${r.result.decision.action}: ${predictionToString(r.result.decision)}`;
        const why = r.result.trace.downgraded
          ? `↓ ${r.result.trace.downgraded.reason}`
          : truncate(r.result.decision.reasoning, 80);
        lines.push(
          `| ${r.ticket.id} | ${r.bucket} | ${escapePipe(gt)} | ${escapePipe(pred)} | ${escapePipe(why)} |`,
        );
      });
    lines.push("");
  }

  return lines.join("\n");
}

function escapePipe(s: string): string {
  return s.replace(/\|/g, "\\|");
}
function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** Single-line per-ticket progress format, used by the CLI streaming output. */
export function formatProgressLine(completed: number, total: number, latest: ScoredResult): string {
  const verdict =
    latest.bucket === "correct_resolve" || latest.bucket === "correct_defer"
      ? "✓"
      : latest.bucket === "false_resolve"
        ? "✗✗✗"
        : "✗";
  const pred = `${latest.result.decision.action}:${predictionToString(latest.result.decision)}`;
  return `[${String(completed).padStart(2)}/${total}] ${verdict.padEnd(3)} ${latest.ticket.id.padEnd(6)} ${latest.bucket.padEnd(24)} ${pred}`;
}
