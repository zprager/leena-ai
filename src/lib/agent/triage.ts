import { chatObject } from "@/lib/llm";
import type { LLMProvider } from "@/lib/llm";
import { retrieve, isCitationGrounded, type RetrievalResult } from "@/lib/rag";
import {
  triageOutputSchema,
  normalizeTriageOutput,
  type TriageDecision,
  type TriageOutput,
} from "./schema";
import { systemPrompt, userPrompt } from "./prompts";

export interface TriageOptions {
  /** Override the default LLM provider for this triage call. */
  provider?: LLMProvider;
  /** Override the default model id for the chosen provider. */
  model?: string;
  /** Use multi-query retrieval — costs an extra LLM call, helps with terse tickets. */
  multiQuery?: boolean;
  /**
   * Override the cosine-similarity floor for "confident enough to RESOLVE".
   * Below this, the post-validation guard downgrades to LOW_CONFIDENCE.
   * Falls back to RETRIEVAL_SCORE_THRESHOLD env var when unset.
   * Used by the calibration sweep to vary the threshold per run without
   * restarting the process.
   */
  scoreThreshold?: number;
  /**
   * Enable Cohere cross-encoder reranking on the cosine top-K. Defaults to
   * env RAG_RERANK_ENABLED. Future-proofing knob: at our 60-chunk corpus the
   * eval doesn't move, but it's wired through for when the corpus grows.
   */
  rerank?: boolean;
  /** Disable post-validation downgrades (debugging only). */
  skipValidation?: boolean;
}

export interface TriageTrace {
  retrieval: RetrievalResult;
  /** The raw flat output from the LLM, before any normalization or downgrade. */
  rawOutput: TriageOutput;
  /** If post-validation downgraded RESOLVE → DEFER, this records why. */
  downgraded: { from: "RESOLVE"; reason: string } | null;
  /** Wall-clock duration in ms, for eval timing. */
  durationMs: number;
}

export interface TriageResult {
  decision: TriageDecision;
  trace: TriageTrace;
}

/**
 * The agent's decision function. Pure with respect to the ticket: same input
 * + same retrieval state + same temperature gives the same output. Side
 * effects (JIRA writes, logging) belong to callers.
 *
 * Flow:
 *   1. Retrieve relevant policy sections (RAG layer).
 *   2. Ask the LLM to classify, constrained to the schema.
 *   3. Normalize the flat output into the discriminated TriageDecision union.
 *   4. Post-validate: if the LLM returned RESOLVE with an ungrounded citation
 *      or below-threshold retrieval, downgrade to LOW_CONFIDENCE DEFER. This
 *      is the grounding guarantee — the LLM cannot escape it.
 */
export async function triage(
  ticketBody: string,
  opts: TriageOptions = {},
): Promise<TriageResult> {
  const start = Date.now();

  const retrieval = await retrieve(ticketBody, {
    multiQuery: opts.multiQuery,
    scoreThreshold: opts.scoreThreshold,
    rerank: opts.rerank,
  });

  const { object: rawOutput } = await chatObject({
    provider: opts.provider,
    model: opts.model,
    schema: triageOutputSchema,
    system: systemPrompt(),
    prompt: userPrompt(ticketBody, retrieval.contextBlock),
    // Low temperature: we want consistent classifications across replays of
    // the eval set. The schema already constrains structure; temperature just
    // affects free-text fields (answer, note, reasoning).
    temperature: 0.1,
  });

  let decision = normalizeTriageOutput(rawOutput);
  let downgraded: TriageTrace["downgraded"] = null;

  if (!opts.skipValidation && decision.action === "RESOLVE") {
    // Guard 1: the cited section must actually exist in the retrieved set.
    // Without this, the LLM can hallucinate "POL-99 §99.9" past the prompt's
    // grounding instruction. parseCitation+isCitationGrounded is the wall.
    if (!isCitationGrounded(decision.citation, retrieval.hits)) {
      downgraded = {
        from: "RESOLVE",
        reason: `citation "${decision.citation}" not found in retrieved policies`,
      };
      decision = {
        action: "DEFER",
        reasonCode: "LOW_CONFIDENCE",
        note: `Agent produced an ungrounded citation (${decision.citation}). Routing to human.`,
        reasoning: `Original reasoning: ${decision.reasoning}`,
      };
    } else if (retrieval.belowThreshold) {
      // Guard 2: even if the citation parses to a real section, if the
      // retrieval as a whole was weak (no chunk crossed the threshold), the
      // grounding is shaky enough to defer.
      downgraded = {
        from: "RESOLVE",
        reason: `top retrieval score ${retrieval.topScore.toFixed(3)} below threshold`,
      };
      decision = {
        action: "DEFER",
        reasonCode: "LOW_CONFIDENCE",
        note: `Retrieval confidence (top=${retrieval.topScore.toFixed(3)}) below threshold; routing to human.`,
        reasoning: `Original reasoning: ${decision.reasoning}`,
      };
    }
  }

  return {
    decision,
    trace: {
      retrieval,
      rawOutput,
      downgraded,
      durationMs: Date.now() - start,
    },
  };
}
