import type { RetrievedPolicy } from "./types";
import type { PolicyChunkPayload } from "@/lib/vector/qdrant";
import { formatCitation } from "@/lib/vector/qdrant";

/** Convert a Qdrant hit into the agent-facing shape. */
export function toRetrievedPolicy(payload: PolicyChunkPayload, score: number): RetrievedPolicy {
  return {
    citation: formatCitation(payload),
    policyId: payload.policyId,
    sectionId: payload.sectionId,
    policyTitle: payload.policyTitle,
    owner: payload.owner,
    text: payload.text,
    score,
  };
}

/**
 * Format retrieved policies as a block ready to inject into the agent prompt.
 * The citation markers ("[POL-02 §2.3]") become the natural anchor the LLM
 * copies into its answer.
 */
export function formatContextBlock(hits: RetrievedPolicy[]): string {
  if (hits.length === 0) return "(no policy sections retrieved)";
  return hits
    .map(
      (h) =>
        `[${h.citation}] ${h.policyTitle}\n${h.text}`,
    )
    .join("\n\n");
}

/**
 * Parse a citation string ("POL-02 §2.3") into its parts. Returns null if it
 * doesn't match the expected shape — the agent layer treats that as a
 * grounding failure.
 */
export function parseCitation(s: string): { policyId: string; sectionId: string } | null {
  // Accept "POL-02 §2.3", "POL-02 §2.3", "POL-02 sec 2.3", "POL-02 section 2.3".
  // Reject anything we can't normalize to a known shape.
  const normalized = s.trim().replace(/sec(tion)?\.?\s*/i, "§");
  const m = /^(POL-\d{2})\s*§\s*(\d+\.\d+)$/i.exec(normalized);
  if (!m) return null;
  return { policyId: m[1].toUpperCase(), sectionId: m[2] };
}

/**
 * Grounding guarantee: a citation only "counts" if the agent actually
 * retrieved that section. The agent layer calls this before accepting a
 * RESOLVE answer.
 */
export function isCitationGrounded(citation: string, hits: RetrievedPolicy[]): boolean {
  const parsed = parseCitation(citation);
  if (!parsed) return false;
  return hits.some(
    (h) => h.policyId === parsed.policyId && h.sectionId === parsed.sectionId,
  );
}
