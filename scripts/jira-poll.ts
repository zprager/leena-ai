/**
 * Start the JIRA poller from the command line.
 *
 * Usage:
 *   npm run jira:poll                  # use env-configured queue + interval
 *   npm run jira:poll -- --once        # run a single iteration, then exit
 *   npm run jira:poll -- --multi-query # enable multi-query retrieval per ticket
 *   npm run jira:poll -- --interval 60000
 *
 * Reads JIRA_* env vars (see .env.example). Exits with code 1 if JIRA isn't
 * configured.
 */
import {
  JiraPoller,
  buildClientFromEnv,
  buildQueueFromEnv,
  triageHandler,
} from "@/lib/jira";
import { env } from "@/lib/env";

interface CliArgs {
  once: boolean;
  multiQuery: boolean;
  intervalMs?: number;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { once: false, multiQuery: false };
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--once") out.once = true;
    else if (a === "--multi-query") out.multiQuery = true;
    else if (a === "--interval") {
      const v = Number(args[++i]);
      if (!Number.isFinite(v) || v <= 0) {
        throw new Error("--interval must be a positive number (ms)");
      }
      out.intervalMs = v;
    } else if (a === "--help" || a === "-h") {
      console.log(
        "usage: npm run jira:poll -- [--once] [--multi-query] [--interval <ms>]",
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

  const client = buildClientFromEnv();
  if (!client) {
    console.error(
      "[jira-poll] JIRA is not configured. Set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN.",
    );
    process.exit(1);
  }

  const queue = buildQueueFromEnv();
  const intervalMs = args.intervalMs ?? env.JIRA_POLL_INTERVAL_MS;

  console.log(`[jira-poll] base=${client.baseUrl} jql=${JSON.stringify(queue.jql)}`);
  console.log(
    `[jira-poll] interval=${intervalMs}ms multiQuery=${args.multiQuery} once=${args.once}`,
  );

  const poller = new JiraPoller({
    client,
    queue,
    intervalMs,
    handler: triageHandler({ multiQuery: args.multiQuery }),
  });

  if (args.once) {
    await poller.runOnce();
    return;
  }

  // Clean shutdown on SIGINT/SIGTERM so we don't lose the in-flight iteration.
  const shutdown = async (signal: string) => {
    console.log(`[jira-poll] ${signal} received, stopping after current iteration…`);
    await poller.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  poller.start();
}

main().catch((err) => {
  console.error("[jira-poll] failed:", err);
  process.exit(1);
});
