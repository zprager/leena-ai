/**
 * Generic JIRA queue poller.
 *
 * Polls a JQL query on an interval, dedupes by ticket key, and dispatches each
 * new ticket to a user-supplied handler. The poller itself knows nothing about
 * the triage pipeline — `triageHandler()` below is the project-specific glue
 * that wires it to `triage()` + `formatComment()` + transitions.
 *
 * Designed to be lifted out of this project: pass any handler you want and
 * point it at any JIRA queue.
 */
import type { JiraClient } from "./client";
import { JiraApiError } from "./client";
import { addLabels, postComment } from "./comments";
import { iterTickets } from "./tickets";
import { transitionTicket } from "./transitions";
import type { JiraQueueConfig, JiraTicket } from "./types";

/** Per-ticket handler. Errors thrown here are caught by the poller and logged. */
export type TicketHandler = (ticket: JiraTicket, ctx: PollerContext) => Promise<void>;

export interface PollerContext {
  client: JiraClient;
  queue: JiraQueueConfig;
  /** Iteration number, starting at 1. */
  iteration: number;
}

export interface PollerOptions {
  client: JiraClient;
  queue: JiraQueueConfig;
  handler: TicketHandler;
  /** Poll interval in ms. Default 30s. */
  intervalMs?: number;
  /** Max tickets pulled per iteration. Default 25. */
  pageSize?: number;
  /**
   * Hook called when a ticket is marked processed. Use this to persist the
   * dedupe set if you need restart safety; defaults to in-memory only.
   */
  onProcessed?: (key: string) => void | Promise<void>;
  /** Seed the dedupe set with previously-processed keys at boot. */
  alreadyProcessed?: Iterable<string>;
  /** Logger; defaults to console. Pass `() => {}` to silence. */
  log?: (event: PollerEvent) => void;
}

export type PollerEvent =
  | { kind: "iteration-start"; iteration: number }
  | { kind: "iteration-end"; iteration: number; processed: number; skipped: number; failed: number; durationMs: number }
  | { kind: "ticket-handled"; key: string }
  | { kind: "ticket-skipped"; key: string; reason: string }
  | { kind: "ticket-failed"; key: string; error: Error }
  | { kind: "fetch-failed"; error: Error };

/**
 * Long-running poller. Call `start()` to begin, `stop()` to cleanly shut down.
 * `runOnce()` is exposed for tests and for the webhook path, where we want a
 * single pull rather than a perpetual loop.
 */
export class JiraPoller {
  private readonly opts: Required<Omit<PollerOptions, "alreadyProcessed">> & {
    alreadyProcessed?: Iterable<string>;
  };
  private readonly processed: Set<string>;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private iteration = 0;

  constructor(options: PollerOptions) {
    this.opts = {
      intervalMs: 30_000,
      pageSize: 25,
      onProcessed: () => {},
      log: defaultLog,
      ...options,
    };
    this.processed = new Set(options.alreadyProcessed ?? []);
  }

  /** Has this key already been handled in the current process? */
  hasProcessed(key: string): boolean {
    return this.processed.has(key);
  }

  /** Mark a key as processed (used externally by the webhook path). */
  async markProcessed(key: string): Promise<void> {
    this.processed.add(key);
    await this.opts.onProcessed(key);
  }

  /**
   * Run one polling iteration: fetch matching tickets, dispatch each to the
   * handler, swallow per-ticket errors so one bad ticket doesn't sink the
   * batch. Fetch failures bubble up to the caller.
   */
  async runOnce(): Promise<{ processed: number; skipped: number; failed: number }> {
    this.iteration += 1;
    const start = Date.now();
    this.opts.log({ kind: "iteration-start", iteration: this.iteration });

    let processed = 0;
    let skipped = 0;
    let failed = 0;

    try {
      for await (const ticket of iterTickets(this.opts.client, {
        jql: this.opts.queue.jql,
        pageSize: this.opts.pageSize,
      })) {
        if (this.processed.has(ticket.key)) {
          skipped += 1;
          this.opts.log({ kind: "ticket-skipped", key: ticket.key, reason: "already-processed" });
          continue;
        }

        try {
          await this.opts.handler(ticket, {
            client: this.opts.client,
            queue: this.opts.queue,
            iteration: this.iteration,
          });
          await this.markProcessed(ticket.key);
          processed += 1;
          this.opts.log({ kind: "ticket-handled", key: ticket.key });
        } catch (err) {
          failed += 1;
          const error = err instanceof Error ? err : new Error(String(err));
          this.opts.log({ kind: "ticket-failed", key: ticket.key, error });
          // Intentionally NOT adding to `processed` — we want the next
          // iteration to retry transient failures. Permanent failures will
          // re-fail, which the operator can spot in logs.
        }
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.opts.log({ kind: "fetch-failed", error });
      throw error;
    } finally {
      this.opts.log({
        kind: "iteration-end",
        iteration: this.iteration,
        processed,
        skipped,
        failed,
        durationMs: Date.now() - start,
      });
    }

    return { processed, skipped, failed };
  }

  /**
   * Start polling. Iterations don't overlap — if one runs long, the next is
   * scheduled `intervalMs` after it finishes (not after it started).
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  /** Stop after the current iteration finishes. Resolves when the loop exits. */
  stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    return Promise.resolve();
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        await this.runOnce();
      } catch {
        // already logged via `fetch-failed`; swallow so the loop keeps running
      }
      if (!this.running) break;
      await new Promise<void>((resolve) => {
        this.timer = setTimeout(() => {
          this.timer = null;
          resolve();
        }, this.opts.intervalMs);
      });
    }
  }
}

// ---------- Triage handler — the project-specific glue ----------

import { formatComment, jiraLabels, triage } from "@/lib/agent";

export interface TriageHandlerOptions {
  /** Pass through to `triage()` — useful for multi-query escalation. */
  multiQuery?: boolean;
}

/**
 * Returns a {@link TicketHandler} that runs the existing triage pipeline:
 *
 *   1. `triage(ticketBody)` → decision + trace
 *   2. Post the rendered comment to the ticket
 *   3. Add the standard `agent-resolved` / `agent-deferred` labels
 *   4. Transition the ticket based on the decision, if a matching transition
 *      id is configured on the queue
 *
 * The ticket body fed to triage is `summary\n\ndescription`, which preserves
 * the most signal without needing to fuse fields more cleverly.
 */
export function triageHandler(opts: TriageHandlerOptions = {}): TicketHandler {
  return async (ticket, ctx) => {
    const body = [ticket.summary, ticket.description].filter(Boolean).join("\n\n");
    const { decision } = await triage(body, { multiQuery: opts.multiQuery });

    const comment = formatComment(decision);
    const labels = jiraLabels(decision);

    // Post comment + labels in parallel — they're independent writes on the
    // same issue and JIRA tolerates concurrent field updates fine.
    await Promise.all([
      postComment(ctx.client, ticket.key, comment),
      addLabels(ctx.client, ticket.key, labels),
    ]);

    const transitionId =
      decision.action === "RESOLVE"
        ? ctx.queue.resolveTransitionId
        : ctx.queue.deferTransitionId;

    if (transitionId) {
      await transitionTicket(ctx.client, ticket.key, transitionId);
    }
  };
}

// ---------- Default logger ----------

function defaultLog(event: PollerEvent): void {
  switch (event.kind) {
    case "iteration-start":
      console.log(`[poller] iter ${event.iteration} start`);
      break;
    case "iteration-end":
      console.log(
        `[poller] iter ${event.iteration} done — processed=${event.processed} skipped=${event.skipped} failed=${event.failed} (${event.durationMs}ms)`,
      );
      break;
    case "ticket-handled":
      console.log(`[poller]   ✓ ${event.key}`);
      break;
    case "ticket-skipped":
      console.log(`[poller]   - ${event.key} (${event.reason})`);
      break;
    case "ticket-failed": {
      const detail = event.error instanceof JiraApiError ? ` [status ${event.error.status}]` : "";
      console.error(`[poller]   ✗ ${event.key}${detail}: ${event.error.message}`);
      break;
    }
    case "fetch-failed":
      console.error(`[poller] fetch failed: ${event.error.message}`);
      break;
  }
}
