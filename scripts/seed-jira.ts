/**
 * Seed a JIRA project with tickets so the agent has something to triage live.
 *
 * Usage:
 *   npm run seed:jira                                # all 50 from fixtures/eval-50.json
 *   npm run seed:jira -- --limit 10                  # just the first 10
 *   npm run seed:jira -- --source mock               # use the 8 mock tickets instead
 *   npm run seed:jira -- --file fixtures/custom.json # custom file
 *   npm run seed:jira -- --dry-run                   # show what would be posted, don't create
 *   npm run seed:jira -- --issue-type Task           # override "Task" default
 *   npm run seed:jira -- --project HELP              # override JIRA_PROJECT_KEY
 *
 * Idempotency: this script does NOT check for duplicates. Running twice
 * creates two copies. Use --dry-run first; delete from JIRA UI if needed.
 *
 * Ground truth is NOT propagated into JIRA — that would leak answers into the
 * agent's context window. We only stamp a correlation label like `eval-T-046`
 * so you can match the JIRA issue back to the eval row later.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildClientFromEnv, createTicket, type CreateTicketInput } from "@/lib/jira";
import { MOCK_TICKETS } from "@/lib/jira/mock-tickets";
import { env } from "@/lib/env";

interface CliArgs {
  source: "eval" | "mock" | "file";
  file: string;
  limit?: number;
  dryRun: boolean;
  issueType: string;
  projectKey?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const out: CliArgs = {
    source: "eval",
    file: "fixtures/eval-50.json",
    dryRun: false,
    issueType: "Task",
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--file") {
      out.file = args[++i];
      out.source = "file";
    } else if (a === "--source") {
      const v = args[++i];
      if (v !== "eval" && v !== "mock" && v !== "file") {
        throw new Error(`--source must be eval|mock|file, got "${v}"`);
      }
      out.source = v;
    } else if (a === "--limit") {
      const v = Number(args[++i]);
      if (!Number.isFinite(v) || v <= 0) throw new Error("--limit must be > 0");
      out.limit = v;
    } else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--issue-type") out.issueType = args[++i];
    else if (a === "--project") out.projectKey = args[++i];
    else if (a === "--help" || a === "-h") {
      console.log(
        [
          "usage: npm run seed:jira -- [options]",
          "",
          "  --source eval|mock|file  source set (default: eval = fixtures/eval-50.json)",
          "  --file <path>            JSON file (sets --source file)",
          "  --limit <n>              cap how many tickets to create",
          "  --dry-run                print what would happen without creating",
          "  --issue-type <name>      JIRA issue type (default: Task)",
          "  --project <key>          override JIRA_PROJECT_KEY",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error(`unknown arg: ${a}`);
    }
  }
  return out;
}

/**
 * What we feed to createTicket(), per ticket. The {id} is kept around so we
 * can stamp it as a correlation label and report progress nicely.
 */
interface SeedTicket {
  id: string; // e.g. "T-001" or "HELP-101"
  summary: string;
  description: string;
  labels: string[];
}

/** First sentence-ish, capped at 120 chars — passable JIRA summary. */
function deriveSummary(body: string): string {
  const trimmed = body.trim().replace(/\s+/g, " ");
  const m = trimmed.match(/^[^.?!]+[.?!]/);
  const first = m ? m[0].trim() : trimmed;
  if (first.length <= 120) return first;
  return first.slice(0, 117) + "...";
}

async function loadEvalSeed(path: string): Promise<SeedTicket[]> {
  const abs = resolve(process.cwd(), path);
  const raw = await readFile(abs, "utf8");
  const parsed = JSON.parse(raw) as Array<{ id: string; body: string }>;
  return parsed.map((t) => ({
    id: t.id,
    summary: deriveSummary(t.body),
    description: t.body,
    // `seeded` lets the user search for everything we created in one JQL.
    // `eval-T-046` makes per-ticket correlation trivial.
    labels: ["seeded", `eval-${t.id}`],
  }));
}

function loadMockSeed(): SeedTicket[] {
  return MOCK_TICKETS.map((t) => ({
    id: t.key,
    summary: t.summary,
    description: t.description,
    labels: ["seeded", `mock-${t.key.toLowerCase()}`],
  }));
}

async function main() {
  const args = parseArgs(process.argv);

  let tickets: SeedTicket[];
  if (args.source === "mock") {
    tickets = loadMockSeed();
  } else {
    tickets = await loadEvalSeed(args.file);
  }
  if (args.limit) tickets = tickets.slice(0, args.limit);

  const projectKey = args.projectKey ?? env.JIRA_PROJECT_KEY;
  if (!projectKey) {
    console.error("[seed-jira] No project key. Set JIRA_PROJECT_KEY in .env or pass --project.");
    process.exit(1);
  }

  console.error(
    `[seed-jira] source=${args.source}${args.source === "file" ? `(${args.file})` : ""}  project=${projectKey}  count=${tickets.length}  issueType=${args.issueType}  dryRun=${args.dryRun}`,
  );
  console.error("");

  if (args.dryRun) {
    for (const t of tickets) {
      console.log(`[dry] ${t.id}  ${t.summary}  labels=[${t.labels.join(", ")}]`);
    }
    console.error(`\n[seed-jira] dry-run: ${tickets.length} ticket(s) NOT created`);
    return;
  }

  const client = buildClientFromEnv();
  if (!client) {
    console.error(
      "[seed-jira] JIRA is not configured. Set JIRA_BASE_URL / JIRA_EMAIL / JIRA_API_TOKEN in .env.",
    );
    process.exit(1);
  }

  // Serial, not parallel — JIRA Cloud rate-limits aggressively and a
  // botched run is easier to debug one ticket at a time. 50 tickets at
  // ~300ms each = ~15s total, which is fine.
  let created = 0;
  let failed = 0;
  for (const t of tickets) {
    const input: CreateTicketInput = {
      projectKey,
      summary: t.summary,
      description: t.description,
      issueType: args.issueType,
      labels: t.labels,
    };
    try {
      const issue = await createTicket(client, input);
      created += 1;
      console.error(
        `[seed-jira] ✓ ${t.id} → ${issue.key.padEnd(12)} ${t.summary.slice(0, 60)}`,
      );
    } catch (err) {
      failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[seed-jira] ✗ ${t.id}  ${message}`);
    }
  }

  console.error(
    `\n[seed-jira] done. created=${created} failed=${failed}${failed > 0 ? "  (see errors above)" : ""}`,
  );
  if (created > 0) {
    console.error(
      `[seed-jira] visit /tickets to see them, or query JQL: project = ${projectKey} AND labels = "seeded"`,
    );
  }
}

main().catch((err) => {
  console.error("[seed-jira] failed:", err);
  process.exit(1);
});
