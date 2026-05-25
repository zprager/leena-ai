/**
 * Shape of one retrieved policy section. `citation` is the canonical string
 * the agent must include in its answer ("POL-02 §2.3") — it's reconstructed
 * from payload metadata, never asked of the LLM.
 */
export interface RetrievedPolicy {
  citation: string; // "POL-02 §2.3"
  policyId: string; // "POL-02"
  sectionId: string; // "2.3"
  policyTitle: string;
  owner: string;
  text: string; // verbatim section text
  score: number; // similarity score (cosine 0..1) — RRF-fused if multi-query
  /**
   * Cohere rerank relevance score (0..1). Present only when reranking ran.
   * Well-calibrated probability — unlike cosine similarity, this can be
   * thresholded directly without per-corpus calibration.
   */
  rerankScore?: number;
}

export interface RetrievalResult {
  query: string;
  /** All queries used (original + paraphrases, if multi-query was on). */
  queriesUsed: string[];
  hits: RetrievedPolicy[];
  /** Score of the top hit (0 if no hits). */
  topScore: number;
  /** True if topScore is below RETRIEVAL_SCORE_THRESHOLD. Agent uses this for LOW_CONFIDENCE. */
  belowThreshold: boolean;
  /** Pre-formatted policy context, ready to drop into the agent prompt. */
  contextBlock: string;
}

export interface RetrieveOptions {
  topK?: number;
  scoreThreshold?: number;
  /** Enable LLM-driven paraphrase expansion + RRF fusion. */
  multiQuery?: boolean;
  /** Override the number of paraphrases (default: RETRIEVAL_QUERY_VARIANTS). */
  variantCount?: number;
  /** Enable Cohere rerank on the cosine top-K. Default: env RAG_RERANK_ENABLED. */
  rerank?: boolean;
  /** Override how many candidates to pull from Qdrant before reranking. */
  rerankCandidateK?: number;
}
