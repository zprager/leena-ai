/**
 * GET /api/stats — counts for the dashboard summary cards.
 * Mirrors {@link getStats} verbatim; exists so the client can refresh stats
 * without re-rendering the whole dashboard route.
 */
import { NextResponse } from "next/server";
import { getStats } from "@/lib/triage-store";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getStats());
}
