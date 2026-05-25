/**
 * Smoke-test the RAG retrieval layer.
 *
 * Usage:
 *   npm run search -- "how many failed login attempts before lockout"
 *   npm run search -- --multi-query "is what I'm doing allowed"
 *   npm run search -- --rerank "personal cloud storage backup"  # Cohere rerank on top of cosine
 *   npm run search -- --multi-query --rerank "..."
 */
import { retrieve } from "@/lib/rag";

async function main() {
  const args = process.argv.slice(2);
  const multiQuery = args.includes("--multi-query");
  const rerank = args.includes("--rerank");
  const query = args.filter((a) => !a.startsWith("--")).join(" ").trim();

  if (!query) {
    console.error('usage: npm run search -- [--multi-query] [--rerank] "your query here"');
    process.exit(1);
  }

  const result = await retrieve(query, { multiQuery, rerank });

  console.log(`\nquery: ${result.query}`);
  if (result.queriesUsed.length > 1) {
    console.log(`paraphrases:`);
    for (const q of result.queriesUsed.slice(1)) console.log(`  - ${q}`);
  }
  console.log(
    `top cosine: ${result.topScore.toFixed(3)}  ${
      result.belowThreshold ? "⚠️  BELOW THRESHOLD (would DEFER as LOW_CONFIDENCE)" : "✓"
    }${rerank ? "   [reranked]" : ""}\n`,
  );

  for (const hit of result.hits) {
    // When reranked, show BOTH scores so the operator can see the reorder —
    // "cosine 0.45 vs rerank 0.92" tells you reranking is doing real work.
    const rerankNote =
      hit.rerankScore !== undefined ? `  rerank=${hit.rerankScore.toFixed(3)}` : "";
    console.log(`[cos ${hit.score.toFixed(3)}${rerankNote}] ${hit.citation}  —  ${hit.policyTitle}`);
    console.log(`        ${hit.text}`);
    console.log();
  }
}

main().catch((err) => {
  console.error("[search] failed:", err);
  process.exit(1);
});
