/**
 * In-memory log of triage runs, used by the UI for the dashboard counts and
 * the ticket detail view's "last decision" panel.
 *
 * This is deliberately not persisted — it's a demo/UI surface. In production
 * the canonical record lives on the JIRA ticket itself (comment + labels via
 * `formatComment` / `jiraLabels`). The store here just lets us show a unified
 * view across both mock tickets and real ones without round-tripping JIRA.
 *
 * Keyed by the ticket key (or a synthetic `manual-<ts>` key for ad-hoc runs
 * from /triage). Re-triaging an existing key overwrites the prior entry —
 * the dashboard counts each ticket once, by its latest decision.
 */
import type { TriageResult } from "@/lib/agent";

export type TriageSource = "jira" | "mock" | "manual";

export interface StoredTriage {
  /** Ticket key (HELP-101) or synthetic key for manual runs (manual-<ts>). */
  key: string;
  source: TriageSource;
  /** Short label for the list view. For manual runs, a truncated body excerpt. */
  summary: string;
  /** Full text the agent was given (summary + description, or pasted text). */
  body: string;
  result: TriageResult;
  /** ISO timestamp when triage finished. */
  triagedAt: string;
}

// Insertion-order Map preserves "most recent first" if we always set after
// deleting any prior entry. Map iteration order is insertion order in JS.
//
// IMPORTANT: bound to globalThis. Next 16 dev (and HMR in general) can
// instantiate the same module twice — once for the route handler bundle,
// once for the server component bundle — leaving two independent Maps that
// never see each other's writes. The result is silent data loss: the API
// route updates store A, the dashboard reads store B, counts stay at 0.
// globalThis is a single instance across all bundles, so a Map hung off it
// is genuinely shared.
declare global {
  // eslint-disable-next-line no-var
  var __helixTriageStore: Map<string, StoredTriage> | undefined;
}
const store: Map<string, StoredTriage> =
  globalThis.__helixTriageStore ?? (globalThis.__helixTriageStore = new Map());

export function recordTriage(entry: StoredTriage): void {
  // Re-set under the same key: delete first so the entry moves to the end
  // (newest). Map.set on an existing key keeps the original insertion slot.
  store.delete(entry.key);
  store.set(entry.key, entry);
}

export function getTriage(key: string): StoredTriage | undefined {
  return store.get(key);
}

/** All triages, newest first. */
export function listTriages(limit?: number): StoredTriage[] {
  const all = Array.from(store.values()).reverse();
  return typeof limit === "number" ? all.slice(0, limit) : all;
}

export interface TriageStats {
  total: number;
  resolved: number;
  deferred: number;
  downgraded: number;
  /** Mean wall-clock duration in ms across all recorded triages. */
  avgDurationMs: number;
}

export function getStats(): TriageStats {
  let resolved = 0;
  let deferred = 0;
  let downgraded = 0;
  let totalMs = 0;
  for (const entry of store.values()) {
    if (entry.result.decision.action === "RESOLVE") resolved += 1;
    else deferred += 1;
    if (entry.result.trace.downgraded) downgraded += 1;
    totalMs += entry.result.trace.durationMs;
  }
  const total = store.size;
  return {
    total,
    resolved,
    deferred,
    downgraded,
    avgDurationMs: total > 0 ? Math.round(totalMs / total) : 0,
  };
}

/** Test helper — wipes the store. Not exported through any index. */
export function _resetTriageStore(): void {
  store.clear();
}
