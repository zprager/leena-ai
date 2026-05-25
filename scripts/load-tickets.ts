/**
 * Bulk-load tickets from a JIRA queue OR a local JSON fixture and run each
 * through the triage pipeline. Use this for:
 *
 *   - Sanity-checking the agent against a saved 50-ticket eval set
 *   - Smoke-testing against a real (test/staging) JIRA project
 *   - Producing a CSV/JSON snapshot of decisions for review
 *
 * Usage:
 *   # From a local fixture (no JIRA needed)
 *   npm run load:tickets -- --file ./fixtures/tickets.json
 *
 *   # From a JIRA queue
 *   npm run load:tickets -- --jql 'project = HELPDESK ORDER BY created DESC' --limit 25
 *   npm run load:tickets -- --jql 'project = HELPDESK' --write-back  # actually post to JIRA
 *
 *   # Output formats
 *   npm run load:tickets -- --file ./fixtures/tickets.json --format json > results.json
 *   npm run load:tickets -- --file ./fixtures/tickets.json --format csv  > results.csv
 *
 * Fixture format (./fixtures/tickets.json) — either of:
 *   ["I forgot my password…", "What's the VPN policy?"]
 *   [
 *     { "key": "SAMPLE-1", "summary": "MFA issue", "description": "…", "expected": "RESOLVE" },
 *     { "summary": "Slack down?", "labels": ["wrong-intent"] }
 *   ]
 *
 * The `expected` field (optional) lets you sanity-check predicted vs. ground
 * truth at a glance in the CSV/JSON output.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { formatComment, jiraLabels, triage, type TriageDecision } from "@/lib/agent";
import {
  addLabels,
  assignTicket,
  buildClientFromEnv,
  buildQueueFromEnv,
  findUserByEmail,
  iterTickets,
  postComment,
  transitionTicket,
  type JiraTicket,
} from "@/lib/jira";
import { env } from "@/lib/env";

interface CliArgs {
  source: { kind: "jira"; jql?: string } | { kind: "file"; path: string };
  limit?: number;
  multiQuery: boolean;
  writeBack: boolean;
  format: "table" | "json" | "csv";
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const out: CliArgs = {
    source: { kind: "jira" },
    multiQuery: false,
    writeBack: false,
    format: "table",
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--file") out.source = { kind: "file", path: args[++i] };
    else if (a === "--jql") out.source = { kind: "jira", jql: args[++i] };
    else if (a === "--limit") {
      const v = Number(args[++i]);
      if (!Number.isFinite(v) || v <= 0) throw new Error("--limit must be a positive number");
      out.limit = v;
    } else if (a === "--multi-query") out.multiQuery = true;
    else if (a === "--write-back") out.writeBack = true;
    else if (a === "--format") {
      const v = args[++i];
      if (v !== "table" && v !== "json" && v !== "csv") {
        throw new Error(`--format must be table|json|csv, got "${v}"`);
      }
      out.format = v;
    } else if (a === "--help" || a === "-h") {
      console.log(
        [
          "usage: npm run load:tickets -- [options]",
          "",
          "  --file <path>     read tickets from a local JSON fixture",
          "  --jql <query>     pull from JIRA with custom JQL (default: env queue)",
          "  --limit <n>       cap the number of tickets processed",
          "  --multi-query     enable retrieval paraphrasing per ticket",
          "  --write-back      post the decision back to JIRA (default: dry-run)",
          "  --format          table | json | csv (default: table)",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error(`unknown arg: ${a}`);
    }
  }
  return out;
}

// ---------- Source loading ----------

/**
 * Normalized "ticket-like" the triage pipeline can consume. Mirrors the
 * essential fields of {@link JiraTicket} so the same downstream code works for
 * both fixture rows and real JIRA issues.
 */
interface InputTicket {
  key: string;
  summary: string;
  description: string;
  labels: string[];
  /** Optional ground truth, only used for output (not the agent). */
  expected?: string;
  /** Present only when the source is JIRA — needed for --write-back. */
  jiraTicket?: JiraTicket;
}

async function loadFromFile(path: string, limit?: number): Promise<InputTicket[]> {
  const abs = resolve(process.cwd(), path);
  const raw = await readFile(abs, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`fixture must be a JSON array, got ${typeof parsed}`);
  }

  const tickets = parsed.map((entry, i) => normalizeFixtureEntry(entry, i));
  return limit ? tickets.slice(0, limit) : tickets;
}

function normalizeFixtureEntry(entry: unknown, index: number): InputTicket {
  if (typeof entry === "string") {
    return {
      key: `FIXTURE-${index + 1}`,
      summary: entry,
      description: "",
      labels: [],
    };
  }
  if (entry && typeof entry === "object") {
    const e = entry as Record<string, unknown>;
    const summary = typeof e.summary === "string" ? e.summary : "";
    const description = typeof e.description === "string" ? e.description : "";
    if (!summary && !description) {
      throw new Error(`fixture[${index}]: needs at least summary or description`);
    }
    return {
      key: typeof e.key === "string" ? e.key : `FIXTURE-${index + 1}`,
      summary,
      description,
      labels: Array.isArray(e.labels) ? e.labels.filter((l): l is string => typeof l === "string") : [],
      expected: typeof e.expected === "string" ? e.expected : undefined,
    };
  }
  throw new Error(`fixture[${index}]: must be a string or object, got ${typeof entry}`);
}

async function* loadFromJira(jql: string, limit?: number): AsyncGenerator<InputTicket> {
  const client = buildClientFromEnv();
  if (!client) {
    throw new Error("JIRA is not configured. Set JIRA_BASE_URL/EMAIL/API_TOKEN or use --file.");
  }
  let yielded = 0;
  for await (const t of iterTickets(client, { jql })) {
    yield {
      key: t.key,
      summary: t.summary,
      description: t.description,
      labels: t.labels,
      jiraTicket: t,
    };
    yielded += 1;
    if (limit && yielded >= limit) return;
  }
}

// ---------- Per-ticket processing ----------

interface ProcessResult {
  key: string;
  expected?: string;
  action: "RESOLVE" | "DEFER";
  citationOrReason: string;
  durationMs: number;
  downgraded: string | null;
  writeBack?: {
    posted: boolean;
    transitioned: boolean;
    assigned: boolean;
    error?: string;
  };
}

/**
 * Context passed to processTicket / writeBackToJira so we don't re-resolve
 * env or look up the assignee on every ticket. Built once in main().
 */
interface RunContext {
  assigneeAccountId: string | null;
  /** Surface lookup failures once at startup, not per-ticket. */
  assigneeLookupError: string | null;
}

async function processTicket(
  ticket: InputTicket,
  args: CliArgs,
  ctx: RunContext,
): Promise<ProcessResult> {
  const body = [ticket.summary, ticket.description].filter(Boolean).join("\n\n");
  const { decision, trace } = await triage(body, { multiQuery: args.multiQuery });

  const result: ProcessResult = {
    key: ticket.key,
    expected: ticket.expected,
    action: decision.action,
    citationOrReason: decision.action === "RESOLVE" ? decision.citation : decision.reasonCode,
    durationMs: trace.durationMs,
    downgraded: trace.downgraded?.reason ?? null,
  };

  if (args.writeBack && ticket.jiraTicket) {
    result.writeBack = await writeBackToJira(ticket.jiraTicket.key, decision, ctx);
  }

  return result;
}

async function writeBackToJira(
  key: string,
  decision: TriageDecision,
  ctx: RunContext,
): Promise<NonNullable<ProcessResult["writeBack"]>> {
  const client = buildClientFromEnv();
  if (!client) {
    return { posted: false, transitioned: false, assigned: false, error: "no JIRA client" };
  }

  const queue = buildQueueFromEnv();
  try {
    await Promise.all([
      postComment(client, key, formatComment(decision)),
      addLabels(client, key, jiraLabels(decision)),
    ]);

    // Transition + assign run sequentially after the comment is up. We don't
    // parallelize with the comment because some workflows have transition
    // screens that reject the post if the issue is mid-transition.
    const transitionId =
      decision.action === "RESOLVE" ? queue.resolveTransitionId : queue.deferTransitionId;
    let transitioned = false;
    if (transitionId) {
      await transitionTicket(client, key, transitionId);
      transitioned = true;
    }

    let assigned = false;
    if (ctx.assigneeAccountId) {
      await assignTicket(client, key, ctx.assigneeAccountId);
      assigned = true;
    }

    return { posted: true, transitioned, assigned };
  } catch (err) {
    return {
      posted: false,
      transitioned: false,
      assigned: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Resolve JIRA_ASSIGNEE_EMAIL → accountId, once. The triage pipeline runs
 * fine without an assignee (the field just stays empty); we only fail loud
 * if the email is set AND we can't find it.
 */
async function resolveAssignee(writeBack: boolean): Promise<RunContext> {
  const email = env.JIRA_ASSIGNEE_EMAIL;
  if (!writeBack || !email) {
    return { assigneeAccountId: null, assigneeLookupError: null };
  }
  const client = buildClientFromEnv();
  if (!client) {
    return { assigneeAccountId: null, assigneeLookupError: "no JIRA client" };
  }
  try {
    const user = await findUserByEmail(client, email);
    if (!user) {
      return {
        assigneeAccountId: null,
        assigneeLookupError: `JIRA_ASSIGNEE_EMAIL ${email} not found on this site`,
      };
    }
    return { assigneeAccountId: user.accountId, assigneeLookupError: null };
  } catch (err) {
    return {
      assigneeAccountId: null,
      assigneeLookupError: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------- Output formatting ----------

function renderTable(results: ProcessResult[]): void {
  const correct = results.filter((r) => r.expected && r.expected === r.action).length;
  const withExpected = results.filter((r) => r.expected).length;

  for (const r of results) {
    const verdict = r.expected ? (r.expected === r.action ? "✓" : "✗") : " ";
    const wb = r.writeBack
      ? r.writeBack.error
        ? ` write:err(${r.writeBack.error})`
        : ` write:${r.writeBack.posted ? "ok" : "skip"}${r.writeBack.transitioned ? "+trans" : ""}${r.writeBack.assigned ? "+assign" : ""}`
      : "";
    const downgraded = r.downgraded ? `  ↓ ${r.downgraded}` : "";
    console.log(
      `${verdict} ${r.key.padEnd(20)} ${r.action.padEnd(8)} ${r.citationOrReason.padEnd(22)} ${String(r.durationMs).padStart(5)}ms${wb}${downgraded}`,
    );
  }

  console.log();
  console.log(
    `processed=${results.length}  resolve=${results.filter((r) => r.action === "RESOLVE").length}  defer=${results.filter((r) => r.action === "DEFER").length}` +
      (withExpected ? `  accuracy=${correct}/${withExpected} (${((correct / withExpected) * 100).toFixed(1)}%)` : ""),
  );
}

function renderJson(results: ProcessResult[]): void {
  console.log(JSON.stringify(results, null, 2));
}

function renderCsv(results: ProcessResult[]): void {
  console.log("key,expected,action,citation_or_reason,duration_ms,downgraded");
  for (const r of results) {
    const cells = [
      r.key,
      r.expected ?? "",
      r.action,
      r.citationOrReason,
      String(r.durationMs),
      r.downgraded ?? "",
    ].map(csvCell);
    console.log(cells.join(","));
  }
}

function csvCell(s: string): string {
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// ---------- Main ----------

async function* loadSource(args: CliArgs): AsyncGenerator<InputTicket> {
  if (args.source.kind === "file") {
    for (const t of await loadFromFile(args.source.path, args.limit)) yield t;
    return;
  }
  const jql =
    args.source.jql ?? buildQueueFromEnv().jql; // fall back to env-configured queue
  yield* loadFromJira(jql, args.limit);
}

async function main() {
  const args = parseArgs(process.argv);

  // Resolve email → accountId ONCE for the run instead of on every ticket.
  // If write-back is off, this is a no-op.
  const ctx = await resolveAssignee(args.writeBack);

  // Header in table mode so the user knows what's happening; suppressed for
  // json/csv so the output stays machine-parseable.
  if (args.format === "table") {
    const src =
      args.source.kind === "file"
        ? `file=${args.source.path}`
        : `jira jql=${JSON.stringify(args.source.jql ?? buildQueueFromEnv().jql)}`;
    const assigneeNote = args.writeBack
      ? ctx.assigneeAccountId
        ? ` assignee=${env.JIRA_ASSIGNEE_EMAIL}`
        : env.JIRA_ASSIGNEE_EMAIL
          ? ` assignee=UNRESOLVED(${ctx.assigneeLookupError})`
          : " assignee=none"
      : "";
    console.log(
      `[load-tickets] ${src} limit=${args.limit ?? "∞"} multiQuery=${args.multiQuery} writeBack=${args.writeBack}${assigneeNote}`,
    );
    console.log();
  }

  const results: ProcessResult[] = [];
  for await (const ticket of loadSource(args)) {
    try {
      results.push(await processTicket(ticket, args, ctx));
    } catch (err) {
      // One ticket failing shouldn't sink the batch. Record the failure as a
      // synthetic DEFER row so downstream output is still uniform.
      results.push({
        key: ticket.key,
        expected: ticket.expected,
        action: "DEFER",
        citationOrReason: `ERROR: ${err instanceof Error ? err.message : String(err)}`,
        durationMs: 0,
        downgraded: null,
      });
    }
  }

  if (args.format === "json") renderJson(results);
  else if (args.format === "csv") renderCsv(results);
  else renderTable(results);
}

main().catch((err) => {
  console.error("[load-tickets] failed:", err);
  process.exit(1);
});
