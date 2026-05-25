export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="h-7 w-32 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="mt-2 h-4 w-72 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="mt-8 space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-14 animate-pulse rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
          />
        ))}
      </div>
    </div>
  );
}
