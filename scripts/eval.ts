/**
 * Run the 50-ticket eval set and produce a CSV + markdown report.
 *
 * Usage:
 *   npm run eval                                   # default dataset, table to stdout
 *   npm run eval -- --multi-query                  # turn on retrieval paraphrasing
 *   npm run eval -- --concurrency 10               # more in-flight triage calls
 *   npm run eval -- --provider openai              # not implemented yet — see TODO
 *   npm run eval -- --out reports/eval.csv         # also write CSV to file
 *   npm run eval -- --out reports/eval.csv --md reports/eval.md
 *   npm run eval -- --file fixtures/eval-50.json   # explicit dataset path
 *
 * Exit code: 0 if all tickets ran (regardless of accuracy). Non-zero only on
 * runtime errors (bad fixture, unreachable Qdrant, missing API keys).
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  DEFAULT_EVAL_SET_PATH,
  formatProgressLine,
  loadEvalSet,
  runEval,
  toCsv,
  toMarkdown,
} from "@/lib/eval";

interface CliArgs {
  file: string;
  multiQuery: boolean;
  concurrency: number;
  outCsv?: string;
  outMd?: string;
  /** Suppress the streaming progress output (useful when piping to a file). */
  quiet: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const out: CliArgs = {
    file: DEFAULT_EVAL_SET_PATH,
    multiQuery: false,
    concurrency: 5,
    quiet: false,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--file") out.file = args[++i];
    else if (a === "--multi-query") out.multiQuery = true;
    else if (a === "--concurrency") {
      const v = Number(args[++i]);
      if (!Number.isFinite(v) || v <= 0) throw new Error("--concurrency must be > 0");
      out.concurrency = v;
    } else if (a === "--out") out.outCsv = args[++i];
    else if (a === "--md") out.outMd = args[++i];
    else if (a === "--quiet") out.quiet = true;
    else if (a === "--help" || a === "-h") {
      console.log(
        [
          "usage: npm run eval -- [options]",
          "",
          "  --file <path>         eval dataset (default: fixtures/eval-50.json)",
          "  --multi-query         enable retrieval paraphrasing per ticket",
          "  --concurrency <n>     parallel triage calls (default: 5)",
          "  --out <path>          write CSV report to file",
          "  --md <path>           write markdown summary to file",
          "  --quiet               suppress per-ticket progress output",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error(`unknown arg: ${a}`);
    }
  }
  return out;
}

async function writeReport(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

async function main() {
  const args = parseArgs(process.argv);

  const tickets = await loadEvalSet(args.file);
  if (!args.quiet) {
    console.error(
      `[eval] dataset=${args.file} tickets=${tickets.length} multiQuery=${args.multiQuery} concurrency=${args.concurrency}`,
    );
    console.error("");
  }

  const report = await runEval(tickets, {
    multiQuery: args.multiQuery,
    concurrency: args.concurrency,
    onProgress: args.quiet
      ? undefined
      : (completed, total, latest) => {
          // Progress goes to stderr so stdout stays clean for piping the
          // markdown summary or CSV.
          console.error(formatProgressLine(completed, total, latest));
        },
  });

  if (!args.quiet) console.error("");

  // Markdown summary always goes to stdout — quick read after a run.
  const md = toMarkdown(report);
  console.log(md);

  if (args.outCsv) {
    const csv = toCsv(report);
    await writeReport(args.outCsv, csv);
    console.error(`[eval] wrote CSV → ${args.outCsv}`);
  }
  if (args.outMd) {
    await writeReport(args.outMd, md);
    console.error(`[eval] wrote markdown → ${args.outMd}`);
  }
}

main().catch((err) => {
  console.error("[eval] failed:", err);
  process.exit(1);
});
