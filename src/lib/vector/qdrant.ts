import { QdrantClient } from "@qdrant/js-client-rest";
import { env } from "@/lib/env";

let _client: QdrantClient | null = null;

export function qdrant(): QdrantClient {
  if (_client) return _client;
  _client = new QdrantClient({
    url: env.QDRANT_URL,
    apiKey: env.QDRANT_API_KEY || undefined,
    // Local dev: skip the version-compatibility probe so we don't spam warnings.
    checkCompatibility: false,
  });
  return _client;
}

/**
 * Payload we attach to every point. Citations like "POL-02 §2.3" are
 * reconstructed from {policyId, sectionId} so the agent never invents them.
 */
export interface PolicyChunkPayload {
  policyId: string; // e.g. "POL-01"
  policyTitle: string; // e.g. "Password & Authentication Policy"
  sectionId: string; // e.g. "1.4"
  text: string; // the section text
  owner: string;
  effective: string; // ISO date
  [key: string]: unknown; // satisfy Qdrant's Record<string, unknown> payload type
}

export interface SearchHit {
  score: number;
  payload: PolicyChunkPayload;
  id: string | number;
}

/**
 * Create the collection if it doesn't already exist. Idempotent — safe to call
 * on every boot or before each ingest.
 */
export async function ensureCollection(dim: number): Promise<void> {
  const client = qdrant();
  const existing = await client.getCollections();
  const found = existing.collections.find((c) => c.name === env.QDRANT_COLLECTION);
  if (found) return;

  await client.createCollection(env.QDRANT_COLLECTION, {
    vectors: { size: dim, distance: "Cosine" },
  });

  // Indexes for the fields we'll filter on. Qdrant requires a payload index
  // before you can filter, even on small collections.
  await client.createPayloadIndex(env.QDRANT_COLLECTION, {
    field_name: "policyId",
    field_schema: "keyword",
  });
  await client.createPayloadIndex(env.QDRANT_COLLECTION, {
    field_name: "sectionId",
    field_schema: "keyword",
  });
}

export async function upsertChunks(
  points: Array<{ id: string | number; vector: number[]; payload: PolicyChunkPayload }>,
): Promise<void> {
  if (points.length === 0) return;
  await qdrant().upsert(env.QDRANT_COLLECTION, { wait: true, points });
}

export async function searchPolicies(
  vector: number[],
  opts: { limit?: number; scoreThreshold?: number } = {},
): Promise<SearchHit[]> {
  const res = await qdrant().search(env.QDRANT_COLLECTION, {
    vector,
    limit: opts.limit ?? 5,
    score_threshold: opts.scoreThreshold,
    with_payload: true,
  });
  return res.map((r) => ({
    id: r.id,
    score: r.score,
    payload: r.payload as unknown as PolicyChunkPayload,
  }));
}

/** Drop the collection — useful for re-ingesting after policy edits. */
export async function dropCollection(): Promise<void> {
  try {
    await qdrant().deleteCollection(env.QDRANT_COLLECTION);
  } catch {
    // ignore: collection may not exist
  }
}

/** Format a hit as a human-readable citation, e.g. "POL-02 §2.3". */
export function formatCitation(payload: PolicyChunkPayload): string {
  return `${payload.policyId} §${payload.sectionId}`;
}
