/**
 * Vector-store layer — barrel export.
 *
 * Currently Qdrant-only. If we ever swap stores, the public surface stays the
 * same (`ensureCollection`, `upsertChunks`, `searchPolicies`, `dropCollection`)
 * and callers don't need to change.
 */
export {
  qdrant,
  ensureCollection,
  upsertChunks,
  searchPolicies,
  dropCollection,
  formatCitation,
} from "./qdrant";
export type { PolicyChunkPayload, SearchHit } from "./qdrant";
