/**
 * Renders a {@link TriageResult} the same way for both /tickets/[key] and
 * /triage. Read-only and side-effect-free, so it works as a server component
 * (the detail page renders it directly) and embedded inside the client
 * manual-triage page.
 *
 * Layout: a top-of-fold "decision banner" so RESOLVE vs. DEFER is obvious at a
 * glance, then the structured fields the decision carries (answer + citation
 * vs. reason code + note), the formatted comment that would actually be
 * posted to JIRA, and finally the retrieval trace with scores.
 */
import { formatComment, REASON_CODE_META, type TriageResult } from "@/lib/agent";

const SEVERITY_STYLES: Record<"critical" | "high" | "normal", string> = {
  critical:
    "bg-red-100 text-red-900 border-red-200 dark:bg-red-950 dark:text-red-200 dark:border-red-900",
  high: "bg-amber-100 text-amber-900 border-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-900",
  normal:
    "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:border-zinc-800",
};

export function TriageResultView({ result }: { result: TriageResult }) {
  const { decision, trace } = result;
  const isResolve = decision.action === "RESOLVE";

  return (
    <div className="space-y-6">
      {/* Decision banner */}
      <div
        className={`rounded-lg border p-5 ${
          isResolve
            ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40"
            : "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40"
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${
                isResolve
                  ? "bg-emerald-600 text-white"
                  : "bg-amber-600 text-white"
              }`}
            >
              {decision.action}
            </span>
            {!isResolve && (
              <span
                className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-mono ${
                  SEVERITY_STYLES[REASON_CODE_META[decision.reasonCode].severity]
                }`}
                title={REASON_CODE_META[decision.reasonCode].description}
              >
                {decision.reasonCode}
              </span>
            )}
          </div>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {trace.durationMs} ms · top score {trace.retrieval.topScore.toFixed(3)}
            {trace.retrieval.belowThreshold ? " (below threshold)" : ""}
          </span>
        </div>

        {/* Decision body */}
        {isResolve ? (
          <div className="mt-4 space-y-3">
            <p className="whitespace-pre-wrap text-zinc-800 dark:text-zinc-100">
              {decision.answer}
            </p>
            <div className="inline-flex items-center gap-2 rounded-md bg-white px-2.5 py-1 font-mono text-xs text-emerald-800 ring-1 ring-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-200 dark:ring-emerald-800">
              <span className="opacity-60">Source:</span>
              <span className="font-semibold">{decision.citation}</span>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <p className="whitespace-pre-wrap text-zinc-800 dark:text-zinc-100">
              {decision.note}
            </p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              <span className="font-medium">Why this code:</span>{" "}
              {REASON_CODE_META[decision.reasonCode].description}
            </p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              <span className="font-medium">Suggested routing:</span>{" "}
              {REASON_CODE_META[decision.reasonCode].routeTo}
            </p>
          </div>
        )}
      </div>

      {/* Post-validation downgrade — only shown when it actually fired */}
      {trace.downgraded && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 dark:border-orange-900 dark:bg-orange-950/40">
          <h3 className="text-sm font-semibold text-orange-900 dark:text-orange-200">
            Post-validation downgrade
          </h3>
          <p className="mt-1 text-sm text-orange-800 dark:text-orange-300">
            The LLM returned <span className="font-mono">{trace.downgraded.from}</span>, but it
            failed the grounding guard: {trace.downgraded.reason}. Downgraded to{" "}
            <span className="font-mono">DEFER · LOW_CONFIDENCE</span>.
          </p>
        </div>
      )}

      {/* Agent reasoning */}
      <Section title="Agent reasoning" subtitle="Internal — not shown to the user">
        <p className="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
          {decision.reasoning}
        </p>
      </Section>

      {/* Formatted comment preview — what would actually be posted to JIRA */}
      <Section
        title="JIRA comment preview"
        subtitle="Verbatim output of formatComment()"
      >
        <pre className="overflow-x-auto rounded-md bg-zinc-50 p-4 text-sm text-zinc-800 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-zinc-800">
          {formatComment(decision)}
        </pre>
      </Section>

      {/* Retrieval trace */}
      <Section
        title="Retrieval trace"
        subtitle={`${trace.retrieval.hits.length} hits${
          trace.retrieval.queriesUsed.length > 1
            ? ` · ${trace.retrieval.queriesUsed.length} queries (multi-query)`
            : ""
        }`}
      >
        {trace.retrieval.queriesUsed.length > 1 && (
          <ul className="mb-3 space-y-1 text-xs text-zinc-500 dark:text-zinc-400">
            {trace.retrieval.queriesUsed.map((q, i) => (
              <li key={i}>
                <span className="mr-2 font-mono text-[10px]">Q{i + 1}</span>
                {q}
              </li>
            ))}
          </ul>
        )}
        {trace.retrieval.hits.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No policy sections retrieved.
          </p>
        ) : (
          <ol className="space-y-3">
            {trace.retrieval.hits.map((hit, i) => (
              <li
                key={`${hit.citation}-${i}`}
                className="rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                      {hit.citation}
                    </span>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {hit.policyTitle}
                    </span>
                  </div>
                  <span
                    className={`font-mono text-xs ${
                      hit.score >= 0.5
                        ? "text-emerald-700 dark:text-emerald-400"
                        : "text-zinc-500 dark:text-zinc-400"
                    }`}
                  >
                    {hit.score.toFixed(3)}
                  </span>
                </div>
                <p className="mt-2 line-clamp-4 text-sm text-zinc-700 dark:text-zinc-300">
                  {hit.text}
                </p>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
        {subtitle && (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">{subtitle}</span>
        )}
      </div>
      {children}
    </section>
  );
}
