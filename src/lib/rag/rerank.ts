/**
 * Cross-encoder rerank via Cohere's Rerank v2 API.
 *
 * Why this exists alongside cosine retrieval:
 *  - Cosine ranks by directional alignment between two pre-computed embeddings.
 *    Each vector was generated without seeing the other — the model can't
 *    "compare" them, only project them into a shared space and hope alignment
 *    correlates with relevance.
 *  - A cross-encoder reranker reads the query AND each candidate together in
 *    a single forward pass. It can score "how well does THIS document answer
 *    THIS specific question" directly — strictly more information than cosine.
 *
 * Why it's opt-in:
 *  - Adds a network round-trip + ~$0.001/query in API cost.
 *  - At our 60-chunk corpus, the cosine ranking is already near-perfect (eval
 *    score 100% at threshold=0.30) — there's no headroom for the reranker to
 *    recover. It earns its keep at scale (corpus growth, adversarial queries,
 *    very-tight precision requirements). Wired up now as future-proofing.
 *
 * Failure behavior:
 *  - Any error (missing API key, 5xx, timeout) logs a warning and returns the
 *    input hits in their original (cosine) order. The retrieve() path stays
 *    available even when the reranker is misconfigured or down.
 */
import { env } from "@/lib/env";
import type { RetrievedPolicy } from "./types";

interface CohereRerankResult {
  index: number;
  relevance_score: number;
}

interface CohereRerankResponse {
  id?: string;
  results: CohereRerankResult[];
}

export interface RerankOptions {
  /** Max docs returned after reranking (default: input length — return all, just reordered). */
  topK?: number;
  /** Override the Cohere model id (default: env RERANK_MODEL). */
  model?: string;
  /** Per-request timeout in ms. Default 10s. */
  timeoutMs?: number;
}

/**
 * Rerank a list of cosine-retrieved policies with Cohere's cross-encoder.
 *
 * Mutates each returned hit's `rerankScore` (added) but preserves the
 * original `score` (cosine) — so the threshold check downstream keeps the
 * same meaning regardless of whether reranking ran.
 */
export async function rerankHits(
  query: string,
  hits: RetrievedPolicy[],
  opts: RerankOptions = {},
): Promise<RetrievedPolicy[]> {
  if (hits.length === 0) return hits;
  const topK = Math.min(opts.topK ?? hits.length, hits.length);
  const model = opts.model ?? env.RERANK_MODEL;
  const timeoutMs = opts.timeoutMs ?? 10_000;

  if (!env.COHERE_API_KEY) {
    console.warn("[rerank] COHERE_API_KEY not set — returning cosine ordering");
    return hits.slice(0, topK);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch("https://api.cohere.com/v2/rerank", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.COHERE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        query,
        documents: hits.map((h) => h.text),
        top_n: topK,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Cohere rerank ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = (await res.json()) as CohereRerankResponse;
    // Reorder by Cohere's results array; attach rerankScore; keep the
    // original cosine in `score`. Index points back at the original `hits`
    // array, so the citation/payload/text all come along unchanged.
    return data.results.map((r) => ({
      ...hits[r.index],
      rerankScore: r.relevance_score,
    }));
  } catch (err) {
    // Don't sink retrieve() on a rerank hiccup. Log + degrade gracefully.
    console.warn("[rerank] falling back to cosine ordering:", err instanceof Error ? err.message : err);
    return hits.slice(0, topK);
  } finally {
    clearTimeout(timer);
  }
}
