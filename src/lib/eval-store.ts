/**
 * In-memory cache of the most recent eval run.
 *
 * Lives next to {@link triage-store.ts} and follows the same convention —
 * not persisted, lost on process restart. Survives a page navigation
 * (Next dev keeps the Node process alive across renders) but not a full
 * `next dev` reload. That's the right tradeoff for a demo: a fresh
 * deploy starts empty and the operator runs the eval again.
 */
import type { EvalReport } from "@/lib/eval";

export interface StoredEvalRun {
  runAt: string; // ISO timestamp
  options: { multiQuery: boolean; concurrency: number };
  report: EvalReport;
}

// Bound to globalThis for the same reason as triage-store: Next 16 dev can
// instantiate this module twice, so a plain module-scope `let` results in
// the API route's write being invisible to the page's read. Holding the
// value off globalThis is a single instance across all bundles.
declare global {
  // eslint-disable-next-line no-var
  var __helixEvalLastRun: StoredEvalRun | null | undefined;
}
if (globalThis.__helixEvalLastRun === undefined) {
  globalThis.__helixEvalLastRun = null;
}

export function getLastEvalRun(): StoredEvalRun | null {
  return globalThis.__helixEvalLastRun ?? null;
}

export function setLastEvalRun(run: StoredEvalRun): void {
  globalThis.__helixEvalLastRun = run;
}
