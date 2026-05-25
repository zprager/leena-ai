/**
 * Create a fresh JIRA project for the agent to triage tickets in.
 *
 * Usage:
 *   npm run jira:create-project                          # uses JIRA_PROJECT_KEY from env
 *   npm run jira:create-project -- --key HELP --name "Helpdesk"
 *   npm run jira:create-project -- --template itsm       # JSM IT service mgmt
 *   npm run jira:create-project -- --dry-run             # show what would post
 *   npm run jira:create-project -- --list-templates      # show available aliases
 *
 * Requires SITE ADMIN privileges. The Atlassian account that created the
 * Jira site is the admin by default; regular users get 403.
 *
 * After success: pipe the printed `JIRA_PROJECT_KEY=...` line into your
 * .env (or copy-paste), then `npm run seed:jira` to populate it.
 */
import { buildClientFromEnv } from "@/lib/jira";
import {
  createProject,
  listTemplates,
  validateProjectKey,
  type TemplateAlias,
} from "@/lib/jira/projects";
import { env } from "@/lib/env";

const VALID_TEMPLATES = new Set(listTemplates().map((t) => t.alias));

interface CliArgs {
  key?: string;
  name?: string;
  template: TemplateAlias;
  description?: string;
  dryRun: boolean;
  listTemplates: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const out: CliArgs = { template: "kanban", dryRun: false, listTemplates: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--key") out.key = args[++i];
    else if (a === "--name") out.name = args[++i];
    else if (a === "--template") {
      const v = args[++i];
      if (!VALID_TEMPLATES.has(v as TemplateAlias)) {
        throw new Error(
          `Unknown --template "${v}". Valid: ${[...VALID_TEMPLATES].join(", ")}`,
        );
      }
      out.template = v as TemplateAlias;
    } else if (a === "--description") out.description = args[++i];
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--list-templates") out.listTemplates = true;
    else if (a === "--help" || a === "-h") {
      console.log(
        [
          "usage: npm run jira:create-project -- [options]",
          "",
          "  --key <KEY>           2-10 uppercase chars (default: JIRA_PROJECT_KEY)",
          "  --name <name>         display name (default: '<KEY> Helpdesk')",
          "  --template <alias>    project template — see --list-templates (default: kanban)",
          "  --description <text>  project description",
          "  --dry-run             print the request body, don't POST",
          "  --list-templates      show available --template aliases",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error(`unknown arg: ${a}`);
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.listTemplates) {
    console.log("Available --template aliases:\n");
    for (const t of listTemplates()) {
      console.log(`  ${t.alias.padEnd(10)} ${t.description}`);
    }
    return;
  }

  const key = args.key ?? env.JIRA_PROJECT_KEY;
  if (!key) {
    console.error(
      "[create-project] no project key. Set JIRA_PROJECT_KEY in .env or pass --key.",
    );
    process.exit(1);
  }
  try {
    validateProjectKey(key);
  } catch (err) {
    console.error(`[create-project] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const name = args.name ?? `${key} Helpdesk`;
  const input = {
    key,
    name,
    template: args.template,
    description: args.description,
  };

  console.error(
    `[create-project] key=${key}  name="${name}"  template=${args.template}  dryRun=${args.dryRun}`,
  );

  if (args.dryRun) {
    console.log(JSON.stringify(input, null, 2));
    return;
  }

  const client = buildClientFromEnv();
  if (!client) {
    console.error(
      "[create-project] JIRA is not configured. Set JIRA_BASE_URL / JIRA_EMAIL / JIRA_API_TOKEN in .env.",
    );
    process.exit(1);
  }

  try {
    const result = await createProject(client, input);
    console.error(`\n[create-project] ✓ created project ${result.key} (id=${result.id})`);
    const projectUrl =
      env.JIRA_BASE_URL && `${env.JIRA_BASE_URL.replace(/\/$/, "")}/browse/${result.key}`;
    if (projectUrl) console.error(`[create-project] URL: ${projectUrl}`);
    console.error(`\n[create-project] next steps:`);
    console.error(`  1. Add to .env (or confirm it's already there):`);
    console.error(`     JIRA_PROJECT_KEY=${result.key}`);
    console.error(`  2. Seed sample tickets:`);
    console.error(`     npm run seed:jira -- --dry-run --limit 5     # preview first`);
    console.error(`     npm run seed:jira                            # then real`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\n[create-project] ✗ failed: ${message}`);
    // The two errors people hit most — call out actionable next steps.
    if (/permission|forbidden|403/i.test(message)) {
      console.error(
        `  → Project creation requires SITE ADMIN. The account that created the Jira site has it by default.`,
      );
      console.error(
        `  → Workaround: create the project manually in JIRA UI, then run \`npm run seed:jira\`.`,
      );
    }
    if (/template|not.*available|400/i.test(message)) {
      console.error(
        `  → Template may not be enabled on this site. Try \`--template kanban\` (works everywhere).`,
      );
    }
    if (/key.*exists|409/i.test(message)) {
      console.error(
        `  → A project with key "${key}" already exists. Pass --key NEW or delete the old one first.`,
      );
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[create-project] failed:", err);
  process.exit(1);
});
