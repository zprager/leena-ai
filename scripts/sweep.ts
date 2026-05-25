/**
 * Run a calibration sweep — runs the eval at every threshold in --thresholds
 * and persists the result to reports/sweeps/<sweepId>.json.
 *
 * Usage:
 *   npm run sweep                                                # default 0.30:0.55:0.05
 *   npm run sweep -- --thresholds 0.30:0.55:0.05                 # range shorthand
 *   npm run sweep -- --thresholds 0.30,0.40,0.50                 # explicit list
 *   npm run sweep -- --multi-query --concurrency 10
 *   npm run sweep -- --description "baseline after T-046 fix"
 *
 * Stdout: ASCII comparison table at the end. Stderr: per-run progress.
 * Files: reports/sweeps/<sweepId>.json (saved on success even if some
 * individual runs failed — they're recorded as gaps).
 */
import { parseThresholds, runSweep, type SweepEvent } from "@/lib/eval";
import { saveSweep } from "@/lib/sweep-store";

interface CliArgs {
  thresholds: number[];
  multiQuery: boolean;
  concurrency: number;
  description?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const out: CliArgs = {
    thresholds: parseThresholds("0.30:0.55:0.05"),
    multiQuery: false,
    concurrency: 5,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--thresholds") out.thresholds = parseThresholds(args[++i]);
    else if (a === "--multi-query") out.multiQuery = true;
    else if (a === "--concurrency") {
      const v = Number(args[++i]);
      if (!Number.isFinite(v) || v <= 0) throw new Error("--concurrency must be > 0");
      out.concurrency = v;
    } else if (a === "--description") out.description = args[++i];
    else if (a === "--help" || a === "-h") {
      console.log(
        [
          "usage: npm run sweep -- [options]",
          "",
          "  --thresholds <spec>   comma list or start:end:step (default 0.30:0.55:0.05)",
          "  --multi-query         enable retrieval paraphrasing in every run",
          "  --concurrency <n>     parallel triage calls per run (default 5)",
          "  --description <text>  optional note saved with the sweep file",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error(`unknown arg: ${a}`);
    }
  }
  return out;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

async function main() {
  const args = parseArgs(process.argv);
  console.error(
    `[sweep] thresholds=[${args.thresholds.join(", ")}] multiQuery=${args.multiQuery} concurrency=${args.concurrency}`,
  );
  console.error("");

  const onEvent = (event: SweepEvent) => {
    switch (event.type) {
      case "sweep-start":
        console.error(
          `[sweep] starting ${event.sweepId} (${event.ticketCount} tickets × ${event.values.length} thresholds)`,
        );
        break;
      case "run-start":
        console.error(
          `[sweep] threshold=${event.threshold.toFixed(2)} (run ${event.index + 1}/${event.total})`,
        );
        break;
      case "run-complete": {
        const r = event.run.report;
        console.error(
          `[sweep]   weightedError=${r.weightedError.toFixed(2)}  score=${(r.normalizedScore * 100).toFixed(1)}%  ` +
            `false_resolve=${r.buckets.false_resolve}  missed_resolve=${r.buckets.missed_resolve}  (${event.run.durationMs}ms)`,
        );
        break;
      }
      case "error":
        console.error(
          `[sweep] error${event.threshold !== undefined ? ` @ ${event.threshold}` : ""}: ${event.message}`,
        );
        break;
    }
  };

  const sweep = await runSweep({
    thresholds: args.thresholds,
    multiQuery: args.multiQuery,
    concurrency: args.concurrency,
    description: args.description,
    onEvent,
  });

  const path = await saveSweep(sweep);
  console.error(`\n[sweep] saved → ${path}`);

  // Comparison table to stdout — easy to paste into a PR or design doc.
  console.log("");
  console.log("| Threshold | Correct | False Resolve | Missed | WrongCite | WrongReason | WeightedErr | Score |");
  console.log("|----------:|--------:|--------------:|-------:|----------:|------------:|------------:|------:|");
  for (const r of sweep.runs) {
    const b = r.report.buckets;
    const star = r.threshold === sweep.best.threshold ? " ★" : "  ";
    console.log(
      `| ${r.threshold.toFixed(2)}${star} | ${b.correct_resolve + b.correct_defer} | ${b.false_resolve} | ${b.missed_resolve} | ${b.wrong_citation_resolve} | ${b.wrong_reason_defer} | ${r.report.weightedError.toFixed(2)} | ${(r.report.normalizedScore * 100).toFixed(1)}% |`,
    );
  }
  console.log("");
  console.log(
    `★ best: threshold=${sweep.best.threshold.toFixed(2)}  weightedError=${sweep.best.weightedError.toFixed(2)}  score=${(sweep.best.normalizedScore * 100).toFixed(1)}%`,
  );
}

main().catch((err) => {
  console.error("[sweep] failed:", err);
  process.exit(1);
});
