export default function Loading() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="h-3 w-24 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="mt-6 h-7 w-1/2 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="mt-2 h-4 w-40 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="mt-6 h-32 animate-pulse rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950" />
      <div className="mt-8 h-48 animate-pulse rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950" />
    </div>
  );
}
