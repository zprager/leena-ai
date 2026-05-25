/**
 * Ingest the 10 IT policies into Qdrant.
 *
 * Usage:
 *   npm run ingest               # incremental upsert
 *   npm run ingest -- --reset    # drop & recreate the collection first
 */
import { allChunks } from "@/lib/knowledge/policies";
import { embedTexts, EMBEDDING_DIM } from "@/lib/llm";
import { ensureCollection, upsertChunks, dropCollection } from "@/lib/vector/qdrant";
import { env } from "@/lib/env";

async function main() {
  const reset = process.argv.includes("--reset");

  if (reset) {
    console.log(`[ingest] dropping collection "${env.QDRANT_COLLECTION}"`);
    await dropCollection();
  }

  console.log(`[ingest] ensuring collection "${env.QDRANT_COLLECTION}" (dim=${EMBEDDING_DIM})`);
  await ensureCollection(EMBEDDING_DIM);

  const chunks = allChunks();
  console.log(`[ingest] embedding ${chunks.length} chunks via ${env.EMBEDDING_PROVIDER}:${env.EMBEDDING_MODEL}`);

  const vectors = await embedTexts(chunks.map((c) => c.embedText));

  const points = chunks.map((c, i) => ({
    id: c.pointId,
    vector: vectors[i],
    payload: {
      policyId: c.policyId,
      policyTitle: c.policyTitle,
      sectionId: c.sectionId,
      owner: c.owner,
      effective: c.effective,
      text: c.text,
    },
  }));

  console.log(`[ingest] upserting ${points.length} points`);
  await upsertChunks(points);

  console.log("[ingest] done.");
}

main().catch((err) => {
  console.error("[ingest] failed:", err);
  process.exit(1);
});
