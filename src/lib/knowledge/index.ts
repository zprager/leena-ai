/**
 * Knowledge base — barrel export.
 *
 * The 10 policies are the agent's only authorized knowledge source. Importers
 * should pull from this barrel rather than the underlying file so the storage
 * shape can change without rippling.
 */
export { POLICIES, allChunks } from "./policies";
export type { Policy, PolicySection, PolicyChunk } from "./policies";
