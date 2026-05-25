/**
 * /api/sweep/[id] — fetch one stored sweep by id, with full per-ticket data.
 *
 * Used by the /sweep history list (click to load a past sweep) and by
 * shareable URLs (?sweep=<id>) on the page.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getSweep, deleteSweep } from "@/lib/sweep-store";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const sweep = await getSweep(id);
  if (!sweep) {
    return NextResponse.json({ error: `Sweep ${id} not found` }, { status: 404 });
  }
  return NextResponse.json({ sweep });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const deleted = await deleteSweep(id);
  if (!deleted) {
    return NextResponse.json({ error: `Sweep ${id} not found` }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
