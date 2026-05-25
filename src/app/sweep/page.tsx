/**
 * /sweep — calibrate RETRIEVAL_SCORE_THRESHOLD against the 50-ticket eval set.
 *
 * Flow mirrors /eval at a higher level:
 *  1. On mount, GET /api/sweep for the history of saved sweeps.
 *  2. Form lets the operator pick thresholds + run options.
 *  3. "Start sweep" → POST /api/sweep, parse NDJSON events as they arrive,
 *     fill in the per-threshold table live. Each completed run gets its
 *     headline metrics inserted as a row.
 *  4. On sweep-complete, refresh history. Past sweeps are clickable —
 *     loading one swaps the active table without re-running.
 */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  EvalReport,
  ScoredResult,
  ScoringBucket,
  SweepEvent,
  SweepRunResult,
  StoredSweep,
} from "@/lib/eval";

interface SweepMetadata {
  sweepId: string;
  runAt: string;
  description?: string;
  parameter: "RETRIEVAL_SCORE_THRESHOLD";
  values: number[];
  options: { multiQuery: boolean; concurrency: number };
  best: { threshold: number; weightedError: number; normalizedScore: number };
  totalDurationMs: number;
  runCount: number;
}

type Phase = "idle" | "running" | "complete" | "error";

interface FormState {
  thresholdsSpec: string;
  multiQuery: boolean;
  concurrency: number;
  description: string;
}

const DEFAULT_FORM: FormState = {
  thresholdsSpec: "0.30:0.55:0.05",
  multiQuery: false,
  concurrency: 5,
  description: "",
};

// Same bucket palette as /eval — keeps tables visually aligned.
const BUCKET_CHIP: Record<ScoringBucket, string> = {
  correct_resolve: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  correct_defer: "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-200",
  wrong_citation_resolve: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  wrong_reason_defer: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200",
  missed_resolve: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200",
  false_resolve: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
};

export default function SweepPage() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [history, setHistory] = useState<SweepMetadata[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Running state: filled in by streaming events.
  const [activeSweepId, setActiveSweepId] = useState<string | null>(null);
  const [plannedThresholds, setPlannedThresholds] = useState<number[]>([]);
  const [runResults, setRunResults] = useState<Map<number, SweepRunResult>>(new Map());
  const [currentThreshold, setCurrentThreshold] = useState<number | null>(null);
  const [innerProgress, setInnerProgress] = useState<{ completed: number; total: number } | null>(
    null,
  );

  // Completed/loaded sweep — the source of truth for the results table.
  const [sweep, setSweep] = useState<StoredSweep | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/sweep");
      const data: { sweeps: SweepMetadata[] } = await res.json();
      setHistory(data.sweeps);
    } catch {
      // Silent — empty history is fine.
    }
  }, []);

  // Load history once on mount, and again whenever a sweep completes.
  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const handleEvent = useCallback((event: SweepEvent) => {
    switch (event.type) {
      case "sweep-start":
        setActiveSweepId(event.sweepId);
        setPlannedThresholds(event.values);
        setRunResults(new Map());
        setCurrentThreshold(null);
        setInnerProgress(null);
        break;
      case "run-start":
        setCurrentThreshold(event.threshold);
        setInnerProgress({ completed: 0, total: 0 });
        break;
      case "run-progress":
        setInnerProgress({ completed: event.completed, total: event.total });
        break;
      case "run-complete":
        setRunResults((prev) => {
          const next = new Map(prev);
          next.set(event.threshold, event.run);
          return next;
        });
        setInnerProgress(null);
        break;
      case "sweep-complete":
        setSweep(event.sweep);
        setPhase("complete");
        setCurrentThreshold(null);
        loadHistory(); // refresh history list
        break;
      case "error":
        setError(event.message);
        setPhase("error");
        break;
    }
  }, [loadHistory]);

  const startSweep = useCallback(async () => {
    setPhase("running");
    setError(null);
    setSweep(null);
    setRunResults(new Map());
    setCurrentThreshold(null);

    try {
      const res = await fetch("/api/sweep", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          thresholds: form.thresholdsSpec,
          multiQuery: form.multiQuery,
          concurrency: form.concurrency,
          description: form.description || undefined,
        }),
      });
      if (!res.ok || !res.body) {
        const fallback = await res.json().catch(() => ({}));
        throw new Error(fallback?.error ?? `sweep failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            handleEvent(JSON.parse(line) as SweepEvent);
          } catch {
            // skip — next line will resync
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }, [form, handleEvent]);

  const loadHistorical = useCallback(async (sweepId: string) => {
    setPhase("running"); // brief
    try {
      const res = await fetch(`/api/sweep/${encodeURIComponent(sweepId)}`);
      if (!res.ok) throw new Error(`load failed (${res.status})`);
      const data: { sweep: StoredSweep } = await res.json();
      setSweep(data.sweep);
      setPlannedThresholds(data.sweep.values);
      // Hydrate runResults map for the table from the loaded sweep.
      const map = new Map<number, SweepRunResult>();
      for (const r of data.sweep.runs) map.set(r.threshold, r);
      setRunResults(map);
      setActiveSweepId(data.sweep.sweepId);
      setPhase("complete");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }, []);

  const completedCount = runResults.size;

  // Choose the "displayed" sweep: completed > whatever's loading. The table
  // renders the same way either way.
  const displayedRuns = useMemo(() => {
    if (sweep) return sweep.runs;
    return Array.from(runResults.values()).sort((a, b) => a.threshold - b.threshold);
  }, [sweep, runResults]);

  const winnerThreshold = sweep?.best.threshold ?? null;

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sweep — threshold calibration</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Runs the 50-ticket eval at every threshold in the list and picks the value that
            minimizes weighted error (false_resolve weighted 3×). Saves the full per-ticket data
            to <code className="font-mono text-xs">reports/sweeps/&lt;id&gt;.json</code>.
          </p>
        </div>
      </header>

      <HowItWorks />

      <ControlsBar form={form} setForm={setForm} phase={phase} onRun={startSweep} />

      {phase === "running" && (
        <ActiveRunPanel
          sweepId={activeSweepId}
          plannedThresholds={plannedThresholds}
          completedCount={completedCount}
          currentThreshold={currentThreshold}
          innerProgress={innerProgress}
        />
      )}

      {error && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          <span className="font-medium">Error:</span> {error}
        </div>
      )}

      {displayedRuns.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold tracking-tight">
            Comparison table
            {sweep && (
              <span className="ml-2 text-sm font-normal text-zinc-500">
                · {sweep.runs.length} runs · total {Math.round(sweep.totalDurationMs / 1000)}s
              </span>
            )}
          </h2>
          <ComparisonTable runs={displayedRuns} winnerThreshold={winnerThreshold} />
          {sweep && <WinnerBanner sweep={sweep} />}
        </section>
      )}

      {sweep && (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold tracking-tight">
            Per-threshold bucket detail
          </h2>
          <BucketBreakdownGrid runs={sweep.runs} winnerThreshold={sweep.best.threshold} />
        </section>
      )}

      <HistoryPanel history={history} onLoad={loadHistorical} activeSweepId={activeSweepId} />
    </div>
  );
}

// ---------- Sub-components ----------

/**
 * Self-documenting explainer at the top of the page. Collapsed by default so
 * returning users aren't visually weighed down by it. The content here matches
 * how runSweep() actually behaves — if the logic changes, update this text too.
 */
function HowItWorks() {
  return (
    <details className="mb-4 rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-zinc-700 marker:text-zinc-400 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900/40">
        How this works
      </summary>
      <div className="space-y-4 border-t border-zinc-200 px-4 py-4 text-sm text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">
        <Step
          title="1. Goal"
          body="Find the cosine-similarity threshold that minimizes weighted error on the 50-ticket eval set. The threshold controls when the post-validation guard downgrades a RESOLVE to DEFER · LOW_CONFIDENCE — too high and the agent over-defers correct answers, too low and it risks resolving things it shouldn't."
        />
        <Step
          title="2. Loop"
          body={
            <>
              For each threshold value (sorted ascending, deduped):
              <ol className="ml-5 mt-1 list-decimal space-y-0.5">
                <li>
                  Run the full eval — every ticket through{" "}
                  <code className="font-mono text-xs">triage()</code>, scored against ground truth.
                </li>
                <li>Record headline metrics + per-ticket trace.</li>
              </ol>
              Runs are <strong>sequential</strong>, not parallel — six concurrent eval runs would
              more than triple wall-time once provider rate limits kick in.
            </>
          }
        />
        <Step
          title="3. Scoring"
          body={
            <>
              Each ticket lands in one of six buckets, each with an error weight that matches the
              rubric:
              <ul className="ml-5 mt-1 space-y-0.5">
                <li>
                  <ChipInline color="emerald">correct_resolve</ChipInline> /{" "}
                  <ChipInline color="teal">correct_defer</ChipInline> → <b>0</b>
                </li>
                <li>
                  <ChipInline color="amber">wrong_citation_resolve</ChipInline> /{" "}
                  <ChipInline color="yellow">wrong_reason_defer</ChipInline> → <b>0.5</b>{" "}
                  (right intent, wrong specifics)
                </li>
                <li>
                  <ChipInline color="orange">missed_resolve</ChipInline> → <b>1.0</b> (should
                  RESOLVE; agent over-deferred)
                </li>
                <li>
                  <ChipInline color="red">false_resolve</ChipInline> → <b>3.0</b> (the rubric's
                  headline sin — RESOLVING something that should DEFER)
                </li>
              </ul>
              A run's <em>weighted error</em> is the sum across all tickets. <em>Score</em> is{" "}
              <code className="font-mono text-xs">1 − weighted_error / (N × 3)</code>, so 100% =
              perfect, 0% = every ticket maxed out.
            </>
          }
        />
        <Step
          title="4. Winner"
          body="Lowest weighted error wins. Tie-break: the higher threshold — more cautious choices preserve restraint margin if model behavior drifts."
        />
        <Step
          title="5. Persistence"
          body={
            <>
              Each sweep is written to{" "}
              <code className="font-mono text-xs">reports/sweeps/&lt;sweepId&gt;.json</code> with
              full per-ticket data — so you can load any historical sweep later (see the
              <strong> History</strong> table at the bottom) and drill into specific tickets
              across thresholds without re-running.
            </>
          }
        />
      </div>
    </details>
  );
}

function Step({ title, body }: { title: string; body: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {title}
      </div>
      <div className="mt-1 leading-relaxed">{body}</div>
    </div>
  );
}

function ChipInline({
  children,
  color,
}: {
  children: React.ReactNode;
  color: "emerald" | "teal" | "amber" | "yellow" | "orange" | "red";
}) {
  const cls: Record<typeof color, string> = {
    emerald: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
    teal: "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-200",
    amber: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
    yellow: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200",
    orange: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200",
    red: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  };
  return (
    <span
      className={`inline-flex items-center rounded px-1 py-0.5 font-mono text-[10px] ${cls[color]}`}
    >
      {children}
    </span>
  );
}

function ControlsBar({
  form,
  setForm,
  phase,
  onRun,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  phase: Phase;
  onRun: () => void;
}) {
  const running = phase === "running";
  return (
    <div className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-700 dark:text-zinc-300">Thresholds</span>
          <input
            type="text"
            value={form.thresholdsSpec}
            onChange={(e) => setForm({ ...form, thresholdsSpec: e.target.value })}
            disabled={running}
            placeholder="0.30:0.55:0.05 or 0.30,0.40,0.50"
            className="w-72 rounded-md border border-zinc-300 bg-white px-2 py-1 font-mono text-xs focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-950"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.multiQuery}
            onChange={(e) => setForm({ ...form, multiQuery: e.target.checked })}
            disabled={running}
            className="h-4 w-4 rounded border-zinc-300"
          />
          <span className="text-zinc-700 dark:text-zinc-300">Multi-query retrieval</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-zinc-700 dark:text-zinc-300">Concurrency</span>
          <input
            type="number"
            min={1}
            max={20}
            value={form.concurrency}
            onChange={(e) =>
              setForm({ ...form, concurrency: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })
            }
            disabled={running}
            className="w-16 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-950"
          />
        </label>
        <div className="ml-auto">
          <button
            type="button"
            onClick={onRun}
            disabled={running}
            className="inline-flex items-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-zinc-800 disabled:cursor-wait disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            {running ? "Running…" : "Start sweep"}
          </button>
        </div>
      </div>
      <label className="block text-sm">
        <span className="text-zinc-700 dark:text-zinc-300">Description (optional)</span>
        <input
          type="text"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          disabled={running}
          placeholder="e.g. baseline after T-046 fix"
          className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-950"
        />
      </label>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Each run takes ~30s with the defaults · 6 thresholds ≈ 3 min total
      </p>
    </div>
  );
}

function ActiveRunPanel({
  sweepId,
  plannedThresholds,
  completedCount,
  currentThreshold,
  innerProgress,
}: {
  sweepId: string | null;
  plannedThresholds: number[];
  completedCount: number;
  currentThreshold: number | null;
  innerProgress: { completed: number; total: number } | null;
}) {
  const outerTotal = plannedThresholds.length;
  const outerPct = outerTotal > 0 ? Math.round((completedCount / outerTotal) * 100) : 0;
  const inner = innerProgress;
  const innerPct = inner && inner.total > 0 ? Math.round((inner.completed / inner.total) * 100) : 0;

  return (
    <div className="mt-4 space-y-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center justify-between text-sm">
        <span className="text-zinc-700 dark:text-zinc-300">
          {sweepId && <code className="font-mono text-xs">{sweepId}</code>}
        </span>
        <span className="text-zinc-500 dark:text-zinc-400">
          {completedCount}/{outerTotal} thresholds
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        <div
          className="h-full bg-zinc-900 transition-all dark:bg-zinc-100"
          style={{ width: `${outerPct}%` }}
        />
      </div>
      {currentThreshold !== null && inner && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
            <span>
              threshold <span className="font-mono text-zinc-700 dark:text-zinc-300">{currentThreshold.toFixed(2)}</span>{" "}
              · {inner.completed}/{inner.total} tickets
            </span>
            <span>{innerPct}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-900">
            <div
              className="h-full bg-zinc-400 transition-all dark:bg-zinc-600"
              style={{ width: `${innerPct}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ComparisonTable({
  runs,
  winnerThreshold,
}: {
  runs: SweepRunResult[];
  winnerThreshold: number | null;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-800">
        <thead className="bg-zinc-50 dark:bg-zinc-900">
          <tr>
            <Th>Threshold</Th>
            <Th className="text-right">Correct</Th>
            <Th className="text-right text-red-700 dark:text-red-400">FalseResolve</Th>
            <Th className="text-right">MissedResolve</Th>
            <Th className="text-right">WrongCite</Th>
            <Th className="text-right">WrongReason</Th>
            <Th className="text-right">WeightedErr</Th>
            <Th className="text-right">Score</Th>
            <Th className="text-right">Latency</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {runs.map((r) => {
            const b = r.report.buckets;
            const correct = b.correct_resolve + b.correct_defer;
            const isWinner = r.threshold === winnerThreshold;
            return (
              <tr
                key={r.threshold}
                className={
                  isWinner
                    ? "bg-emerald-50 dark:bg-emerald-950/40"
                    : "hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
                }
              >
                <Td>
                  <span className="font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {r.threshold.toFixed(2)}
                  </span>
                  {isWinner && (
                    <span className="ml-2 inline-flex items-center rounded-md bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                      best
                    </span>
                  )}
                </Td>
                <NumTd>{correct}</NumTd>
                <NumTd className={b.false_resolve > 0 ? "text-red-700 dark:text-red-400 font-semibold" : undefined}>
                  {b.false_resolve}
                </NumTd>
                <NumTd>{b.missed_resolve}</NumTd>
                <NumTd>{b.wrong_citation_resolve}</NumTd>
                <NumTd>{b.wrong_reason_defer}</NumTd>
                <NumTd>{r.report.weightedError.toFixed(2)}</NumTd>
                <NumTd className="font-semibold">
                  {(r.report.normalizedScore * 100).toFixed(1)}%
                </NumTd>
                <NumTd className="text-zinc-500">{Math.round(r.durationMs / 1000)}s</NumTd>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function WinnerBanner({ sweep }: { sweep: StoredSweep }) {
  return (
    <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/40">
      <h3 className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
        ★ Recommended: RETRIEVAL_SCORE_THRESHOLD={sweep.best.threshold.toFixed(2)}
      </h3>
      <p className="mt-1 text-sm text-emerald-800 dark:text-emerald-300">
        Score {(sweep.best.normalizedScore * 100).toFixed(1)}% — lowest weighted error
        ({sweep.best.weightedError.toFixed(2)}) among the {sweep.runs.length} tested. Commit this
        value into <code className="font-mono text-xs">.env</code> and document the sweep in the
        production-hardening section of the README.
      </p>
    </div>
  );
}

function BucketBreakdownGrid({
  runs,
  winnerThreshold,
}: {
  runs: SweepRunResult[];
  winnerThreshold: number;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
      {runs.map((r) => {
        const isWinner = r.threshold === winnerThreshold;
        return (
          <div
            key={r.threshold}
            className={`rounded-lg border bg-white p-4 dark:bg-zinc-950 ${
              isWinner
                ? "border-emerald-300 ring-2 ring-emerald-200 dark:border-emerald-800 dark:ring-emerald-900"
                : "border-zinc-200 dark:border-zinc-800"
            }`}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                threshold {r.threshold.toFixed(2)}
              </span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {(r.report.normalizedScore * 100).toFixed(1)}%
              </span>
            </div>
            <BucketChips report={r.report} />
            {r.report.results.some((s) => s.bucket === "false_resolve") && (
              <FailingTickets report={r.report} bucket="false_resolve" />
            )}
          </div>
        );
      })}
    </div>
  );
}

function BucketChips({ report }: { report: EvalReport }) {
  const order: ScoringBucket[] = [
    "correct_resolve",
    "correct_defer",
    "wrong_citation_resolve",
    "wrong_reason_defer",
    "missed_resolve",
    "false_resolve",
  ];
  return (
    <div className="flex flex-wrap gap-1">
      {order.map((b) => {
        const count = report.buckets[b];
        if (count === 0) return null;
        return (
          <span
            key={b}
            className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase ${BUCKET_CHIP[b]}`}
            title={b.replace(/_/g, " ")}
          >
            {b.replace(/_/g, " ")} · {count}
          </span>
        );
      })}
    </div>
  );
}

function FailingTickets({
  report,
  bucket,
}: {
  report: EvalReport;
  bucket: ScoringBucket;
}) {
  const tickets = report.results.filter((r: ScoredResult) => r.bucket === bucket);
  if (tickets.length === 0) return null;
  return (
    <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
      <span className="font-medium text-red-700 dark:text-red-400">false RESOLVE:</span>{" "}
      {tickets.map((t) => t.ticket.id).join(", ")}
    </div>
  );
}

function HistoryPanel({
  history,
  onLoad,
  activeSweepId,
}: {
  history: SweepMetadata[];
  onLoad: (sweepId: string) => void;
  activeSweepId: string | null;
}) {
  if (history.length === 0) return null;
  return (
    <section className="mt-12">
      <h2 className="mb-3 text-lg font-semibold tracking-tight">
        History <span className="text-sm font-normal text-zinc-500">({history.length})</span>
      </h2>
      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-800">
          <thead className="bg-zinc-50 dark:bg-zinc-900">
            <tr>
              <Th>Sweep</Th>
              <Th>When</Th>
              <Th>Thresholds</Th>
              <Th>Options</Th>
              <Th>Description</Th>
              <Th className="text-right">Best</Th>
              <th scope="col" className="px-4 py-2.5"><span className="sr-only">Load</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {history.map((s) => (
              <tr
                key={s.sweepId}
                className={
                  s.sweepId === activeSweepId
                    ? "bg-zinc-50 dark:bg-zinc-900/40"
                    : "hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
                }
              >
                <Td>
                  <span className="font-mono text-[11px] text-zinc-700 dark:text-zinc-300">
                    {s.sweepId.replace("sweep-", "")}
                  </span>
                </Td>
                <Td>
                  <span className="text-xs text-zinc-600 dark:text-zinc-400">
                    {new Date(s.runAt).toLocaleString()}
                  </span>
                </Td>
                <Td>
                  <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                    [{s.values.map((v) => v.toFixed(2)).join(", ")}]
                  </span>
                </Td>
                <Td>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    {s.options.multiQuery ? "MQ" : "·"} · conc {s.options.concurrency}
                  </span>
                </Td>
                <Td>
                  <span className="line-clamp-1 text-xs text-zinc-700 dark:text-zinc-300">
                    {s.description ?? <em className="text-zinc-400">(none)</em>}
                  </span>
                </Td>
                <Td className="text-right">
                  <span className="font-mono text-xs">
                    {s.best.threshold.toFixed(2)} · {(s.best.normalizedScore * 100).toFixed(1)}%
                  </span>
                </Td>
                <Td className="text-right">
                  <button
                    type="button"
                    onClick={() => onLoad(s.sweepId)}
                    className="text-xs font-medium text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
                  >
                    Load →
                  </button>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------- Tiny presentational helpers ----------

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={`px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400 ${className ?? ""}`}
    >
      {children}
    </th>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 align-middle ${className ?? ""}`}>{children}</td>;
}

function NumTd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={`px-4 py-3 text-right align-middle font-mono text-xs ${className ?? ""}`}>
      {children}
    </td>
  );
}
