/**
 * Public RAG entry point. The agent's triage loop calls `retrieve()` and uses
 * the returned {@link RetrievalResult} as the ground truth for "what does the
 * knowledge base say about this ticket."
 *
 * Two modes:
 *   - Single-query (default): one embed → one vector search.
 *   - Multi-query (`opts.multiQuery`): paraphrase the question N times via the
 *     LLM, search each variant independently, then fuse the result lists with
 *     Reciprocal Rank Fusion. Costs one extra LLM call per retrieve — callers
 *     opt in only when the cheap path is borderline.
 *
 * Tunables live in env (`RETRIEVAL_TOP_K`, `RETRIEVAL_SCORE_THRESHOLD`,
 * `RETRIEVAL_QUERY_VARIANTS`) and can be overridden per call via
 * {@link RetrieveOptions}.
 */
import { embedText } from "@/lib/llm";
import { searchPolicies } from "@/lib/vector/qdrant";
import { env } from "@/lib/env";
import { toRetrievedPolicy, formatContextBlock } from "./format";
import { generateQueryVariants, fuseRRF } from "./multi-query";
import { rerankHits } from "./rerank";
import type { RetrievalResult, RetrieveOptions, RetrievedPolicy } from "./types";

/** One embed + one vector search. Hits come back in score-descending order. */
async function retrieveSingle(query: string, topK: number): Promise<RetrievedPolicy[]> {
  const vector = await embedText(query);
  const raw = await searchPolicies(vector, { limit: topK });
  return raw.map((r) => toRetrievedPolicy(r.payload, r.score));
}

export async function retrieve(
  query: string,
  opts: RetrieveOptions = {},
): Promise<RetrievalResult> {
  const topK = opts.topK ?? env.RETRIEVAL_TOP_K;
  const scoreThreshold = opts.scoreThreshold ?? env.RETRIEVAL_SCORE_THRESHOLD;
  const variantCount = opts.variantCount ?? env.RETRIEVAL_QUERY_VARIANTS;
  const rerank = opts.rerank ?? env.RAG_RERANK_ENABLED;
  const candidateK = opts.rerankCandidateK ?? env.RERANK_CANDIDATE_K;

  // When reranking is on, pull a LARGER candidate pool from Qdrant so the
  // reranker has something to actually reorder. The reranker keeps topK; the
  // extra cosine-borderline candidates are exactly where reranking earns its
  // keep (cosine's worst-ranked top-20 vs. its best-ranked top-5).
  const fetchK = rerank ? Math.max(candidateK, topK) : topK;

  let hits: RetrievedPolicy[];
  // Tracked so verbose/eval callers can see exactly what was searched —
  // especially useful for debugging "why did paraphrase #2 surface a worse
  // result than the original."
  let queriesUsed: string[] = [query];

  if (opts.multiQuery && variantCount > 0) {
    const variants = await generateQueryVariants(query, variantCount);
    queriesUsed = [query, ...variants];
    // Pull more than topK per query so RRF has overlap to fuse on — a hit at
    // rank 6 in two lists is more informative than a hit at rank 3 in just
    // one, and we'd miss it if we capped each list at topK.
    const perQueryK = Math.max(fetchK, 8);
    const lists = await Promise.all(
      queriesUsed.map((q) => retrieveSingle(q, perQueryK)),
    );
    hits = fuseRRF(lists).slice(0, fetchK);
  } else {
    hits = await retrieveSingle(query, fetchK);
  }

  // Rerank step (optional). On error, rerankHits returns the cosine ordering
  // unchanged — so failure degrades gracefully instead of sinking the whole
  // retrieve. The threshold check below stays on cosine `score`, not
  // rerankScore — same calibration as the no-rerank path.
  if (rerank && hits.length > 0) {
    hits = await rerankHits(query, hits, { topK });
  } else {
    hits = hits.slice(0, topK);
  }

  // Use the MAX cosine across the returned hits (not hits[0].score) — with
  // rerank on, hits[0] is rerank-top, not cosine-top, so position-0 wouldn't
  // represent the cosine ceiling. Threshold check needs the ceiling, not the
  // ranker's first pick.
  const topScore = hits.length > 0 ? Math.max(...hits.map((h) => h.score)) : 0;
  return {
    query,
    queriesUsed,
    hits,
    topScore,
    // Surfaced as a flag (not a raw score comparison) so the agent layer can
    // decide RESOLVE vs LOW_CONFIDENCE DEFER without knowing the threshold —
    // keeps the calibration knob in one place (env).
    belowThreshold: topScore < scoreThreshold,
    contextBlock: formatContextBlock(hits),
  };
}
