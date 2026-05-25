/**
 * Nav-level "View prompt" dialog. Lets anyone inspecting the agent see the
 * exact system prompt + user-prompt template the LLM receives.
 *
 * Implementation notes:
 *  - Uses the native <dialog> element — built-in focus trap, ESC-to-close,
 *    backdrop click handling. No portal, no focus-trap library.
 *  - Lazy-fetches /api/prompt on first open, then caches. Open/close after
 *    that is instant.
 *  - "Copy" buttons use the Clipboard API and surface a transient checkmark
 *    so the user knows it worked. No toast plumbing.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface PromptPayload {
  system: string;
  userTemplate: string;
  source: { file: string; systemFn: string; userFn: string };
}

export function SystemPromptDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [payload, setPayload] = useState<PromptPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Lazy fetch on first open; subsequent opens reuse the cached payload.
  const ensureLoaded = useCallback(async () => {
    if (payload || loading) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/prompt");
      if (!res.ok) throw new Error(`fetch failed (${res.status})`);
      const data = (await res.json()) as PromptPayload;
      setPayload(data);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [payload, loading]);

  const open = useCallback(() => {
    void ensureLoaded();
    dialogRef.current?.showModal();
  }, [ensureLoaded]);

  // Close-on-backdrop-click: the native <dialog> doesn't do this by default.
  // We listen on the dialog itself; click events whose target IS the dialog
  // (not a child) come from outside the content area.
  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    function onClick(e: MouseEvent) {
      if (e.target === dlg) dlg!.close();
    }
    dlg.addEventListener("click", onClick);
    return () => dlg.removeEventListener("click", onClick);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
        title="View the agent's system prompt and user-prompt template"
      >
        <span aria-hidden>📄</span> View prompt
      </button>

      <dialog
        ref={dialogRef}
        // Native dialog defaults: white box, terrible spacing. We restyle
        // entirely and use ::backdrop for the overlay.
        className="m-0 max-h-[90vh] w-[min(900px,92vw)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-zinc-200 bg-white p-0 shadow-2xl backdrop:bg-zinc-900/50 backdrop:backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950"
        style={{ top: "50%", left: "50%" }}
      >
        <div className="flex h-full max-h-[90vh] flex-col">
          <DialogHeader onClose={() => dialogRef.current?.close()} />
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {loading && !payload && <Skeleton />}
            {loadError && <ErrorPanel message={loadError} />}
            {payload && <PromptBody payload={payload} />}
          </div>
        </div>
      </dialog>
    </>
  );
}

// ---------- Sub-components ----------

function DialogHeader({ onClose }: { onClose: () => void }) {
  return (
    <header className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50 px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div>
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          Agent prompt
        </h2>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          What the LLM receives on every <code className="font-mono">triage()</code> call.
        </p>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M4 4l8 8M12 4l-8 8"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </header>
  );
}

function PromptBody({ payload }: { payload: PromptPayload }) {
  return (
    <div className="space-y-6">
      <PromptSection
        title="System prompt"
        subtitle={`${payload.source.systemFn} from ${payload.source.file}`}
        content={payload.system}
      />
      <PromptSection
        title="User prompt template"
        subtitle={`${payload.source.userFn} — {{PLACEHOLDERS}} are interpolated per ticket`}
        content={payload.userTemplate}
      />
    </div>
  );
}

function PromptSection({
  title,
  subtitle,
  content,
}: {
  title: string;
  subtitle: string;
  content: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore — older browsers / non-https
    }
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          {copied ? "✓ Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto rounded-md bg-zinc-50 p-4 font-mono text-[12.5px] leading-relaxed text-zinc-800 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-zinc-800">
        {content}
      </pre>
    </section>
  );
}

function Skeleton() {
  return (
    <div className="space-y-4">
      <div className="h-3 w-1/3 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="h-40 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
      <div className="h-3 w-1/3 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="h-24 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
    </div>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
      <span className="font-medium">Failed to load prompt:</span> {message}
    </div>
  );
}
