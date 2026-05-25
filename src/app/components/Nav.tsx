/**
 * Top navigation bar — client component so it can highlight the active path.
 * Kept intentionally small; the routes here mirror the UI surface the agent
 * exposes (dashboard / queue / manual sandbox).
 */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SystemPromptDialog } from "./SystemPromptDialog";

const LINKS: Array<{ href: string; label: string }> = [
  { href: "/", label: "Dashboard" },
  { href: "/tickets", label: "Tickets" },
  { href: "/triage", label: "Manual triage" },
  { href: "/eval", label: "Eval" },
  { href: "/sweep", label: "Sweep" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <nav className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
        <Link href="/" className="font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Helix Helpdesk
        </Link>
        <ul className="flex items-center gap-1 text-sm">
          {LINKS.map((link) => {
            // Treat the root link as exact-match so /tickets doesn't keep /
            // visually active; nested routes still highlight their parent.
            const active =
              link.href === "/"
                ? pathname === "/"
                : pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className={`rounded-md px-3 py-1.5 transition-colors ${
                    active
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                  }`}
                >
                  {link.label}
                </Link>
              </li>
            );
          })}
        </ul>
        {/* Right side — always-available diagnostic. */}
        <div className="ml-auto">
          <SystemPromptDialog />
        </div>
      </nav>
    </header>
  );
}
