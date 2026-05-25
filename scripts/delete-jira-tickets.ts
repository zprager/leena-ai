/**
 * Bulk-delete JIRA tickets matching a JQL query.
 *
 * Defaults are SAFETY-FIRST:
 *   - JQL filters by `labels = "seeded"` so we only ever touch tickets the
 *     seed-jira script created — not random tickets in your project.
 *   - Status filter defaults to "Done" — the typical cleanup case after a
 *     demo run.
 *   - Nothing is deleted without an explicit --confirm. Without it, the
 *     script just lists what would be deleted (dry-run).
 *
 * Usage:
 *   npm run jira:delete                                # dry-run: list Done seeded tickets
 *   npm run jira:delete -- --confirm                   # actually delete them
 *   npm run jira:delete -- --jql "project = CHALLENGE AND labels = 'seeded'"
 *   npm run jira:delete -- --jql "..." --confirm --limit 10
 *
 * Requires the "Delete Issues" project permission — site admins have it by
 * default.
 */
import {
  buildClientFromEnv,
  buildQueueFromEnv,
  deleteTicket,
  iterTickets,
} from "@/lib/jira";
import { env } from "@/lib/env";

interface CliArgs {
  jql?: string;
  limit?: number;
  confirm: boolean;
  deleteSubtasks: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const out: CliArgs = { confirm: false, deleteSubtasks: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--jql") out.jql = args[++i];
    else if (a === "--limit") {
      const v = Number(args[++i]);
      if (!Number.isFinite(v) || v <= 0) throw new Error("--limit must be > 0");
      out.limit = v;
    } else if (a === "--confirm") out.confirm = true;
    else if (a === "--delete-subtasks") out.deleteSubtasks = true;
    else if (a === "--help" || a === "-h") {
      console.log(
        [
          "usage: npm run jira:delete -- [options]",
          "",
          "  --jql <query>          custom JQL (default: status = Done AND labels = 'seeded')",
          "  --limit <n>            cap how many tickets to delete",
          "  --confirm              actually delete (without this it's a dry-run)",
          "  --delete-subtasks      cascade delete subtasks",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error(`unknown arg: ${a}`);
    }
  }
  return out;
}

function defaultJql(): string {
  const projectKey = env.JIRA_PROJECT_KEY ?? buildQueueFromEnv().jql.match(/project\s*=\s*(\S+)/)?.[1];
  if (!projectKey) {
    throw new Error("No project key. Set JIRA_PROJECT_KEY or pass --jql explicitly.");
  }
  // labels = "seeded" guarantees we only ever delete tickets seed-jira made.
  // status = Done targets the typical post-demo cleanup case.
  return `project = ${projectKey} AND status = Done AND labels = "seeded"`;
}

async function main() {
  const args = parseArgs(process.argv);
  const jql = args.jql ?? defaultJql();

  const client = buildClientFromEnv();
  if (!client) {
    console.error("[jira:delete] JIRA not configured. Set JIRA_BASE_URL / JIRA_EMAIL / JIRA_API_TOKEN.");
    process.exit(1);
  }

  console.error(
    `[jira:delete] jql=${JSON.stringify(jql)}  limit=${args.limit ?? "∞"}  confirm=${args.confirm}`,
  );
  console.error("");

  // Pull the whole match set first so the "would delete N" count is honest
  // before we start any destructive work.
  const matches: { key: string; summary: string }[] = [];
  for await (const t of iterTickets(client, { jql })) {
    matches.push({ key: t.key, summary: t.summary });
    if (args.limit && matches.length >= args.limit) break;
  }

  if (matches.length === 0) {
    console.error("[jira:delete] no tickets match. Nothing to do.");
    return;
  }

  for (const t of matches) {
    console.log(`  ${t.key.padEnd(16)} ${t.summary.slice(0, 80)}`);
  }
  console.error("");

  if (!args.confirm) {
    console.error(
      `[jira:delete] dry-run: ${matches.length} ticket(s) WOULD be deleted. Re-run with --confirm to do it.`,
    );
    return;
  }

  // Serial, not parallel — JIRA rate-limits and we want clean per-ticket
  // error reporting if any one DELETE fails.
  let deleted = 0;
  let failed = 0;
  let lastError = "";
  for (const t of matches) {
    try {
      await deleteTicket(client, t.key, { deleteSubtasks: args.deleteSubtasks });
      deleted += 1;
      console.error(`[jira:delete] ✓ ${t.key}`);
    } catch (err) {
      failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      lastError = message;
      console.error(`[jira:delete] ✗ ${t.key}  ${message}`);
    }
  }

  console.error(
    `\n[jira:delete] done. deleted=${deleted} failed=${failed}${failed > 0 ? "  (see errors above)" : ""}`,
  );

  // Surface actionable next steps for the failure modes people actually hit.
  // The 403 case is the common one on fresh Kanban projects — Jira's default
  // permission scheme doesn't grant "Delete Issues" to anyone by default.
  if (failed > 0 && /permission|forbidden|403/i.test(lastError)) {
    const projectKey =
      env.JIRA_PROJECT_KEY ?? buildQueueFromEnv().jql.match(/project\s*=\s*(\S+)/)?.[1];
    const siteUrl = env.JIRA_BASE_URL?.replace(/\/$/, "");
    const settingsUrl =
      siteUrl && projectKey
        ? `${siteUrl}/plugins/servlet/project-config/${projectKey}/permissions`
        : null;
    console.error(
      [
        "",
        "→ Your account lacks the \"Delete Issues\" permission on this project.",
        "  Jira's default permission scheme often doesn't grant this — even to",
        "  the project creator. Two ways to fix:",
        "",
        "  A. Grant the permission in the Jira UI (recommended):",
        settingsUrl
          ? `       Open: ${settingsUrl}`
          : "       Project settings → Permissions",
        "       Click the linked permission scheme → \"Delete issues\" row → \"Edit\"",
        "       Add a grant: Application role = \"Any logged in user\" (demo) OR",
        "                    Project role = \"Administrators\" (cleaner)",
        "       Save, then re-run `npm run jira:delete -- --confirm`.",
        "",
        "  B. Skip this script — delete tickets via the Jira UI (bulk-change",
        "     with a site-admin account), or just leave the Done tickets and",
        "     re-seed under fresh keys.",
      ].join("\n"),
    );
  }
}

main().catch((err) => {
  console.error("[jira:delete] failed:", err);
  process.exit(1);
});
