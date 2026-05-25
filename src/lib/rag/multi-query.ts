import { z } from "zod";
import { chatObject } from "@/lib/llm";
import type { RetrievedPolicy } from "./types";

const variantSchema = z.object({
  variants: z.array(z.string().min(3)).max(5),
});

/**
 * Ask the LLM for N paraphrases of a ticket. We give it the IT-helpdesk frame
 * so the rewrites stay in-domain (otherwise it tries to "improve" the question
 * by drifting into adjacent topics).
 *
 * Failure mode: if the LLM refuses or returns junk, we fall back silently to
 * the empty list. Multi-query is always opt-in; degrading to single-query is
 * the right behavior.
 */
export async function generateQueryVariants(
  query: string,
  count: number,
): Promise<string[]> {
  if (count <= 0) return [];
  try {
    const { object } = await chatObject({
      schema: variantSchema,
      system:
        "You rewrite IT helpdesk tickets as concise search queries. " +
        "Each variant should ask the SAME underlying question using different " +
        "wording or keywords that might appear in IT policy documents. " +
        "Do not invent details, broaden scope, or add specifics not in the original.",
      prompt: `Original ticket: "${query}"\n\nReturn ${count} alternative phrasings.`,
      temperature: 0.3,
    });
    return object.variants.slice(0, count);
  } catch {
    return [];
  }
}

/**
 * Reciprocal Rank Fusion. Standard k=60 from the original paper.
 *
 * Each query produces a ranked list. For each unique policy chunk, sum
 * 1/(k+rank) across the lists it appears in. This favors chunks that show up
 * near the top across multiple paraphrases.
 *
 * We keep the highest raw score we've seen per chunk on the merged result so
 * the threshold check stays meaningful (vs. summing RRF scores into the
 * `score` field, which would change its units).
 */
export function fuseRRF(
  rankedLists: RetrievedPolicy[][],
  k = 60,
): RetrievedPolicy[] {
  const fused = new Map<string, { policy: RetrievedPolicy; rrf: number; maxScore: number }>();

  for (const list of rankedLists) {
    list.forEach((policy, rank) => {
      const key = policy.citation;
      const entry = fused.get(key);
      const contribution = 1 / (k + rank);
      if (entry) {
        entry.rrf += contribution;
        if (policy.score > entry.maxScore) entry.maxScore = policy.score;
      } else {
        fused.set(key, { policy, rrf: contribution, maxScore: policy.score });
      }
    });
  }

  return Array.from(fused.values())
    .sort((a, b) => b.rrf - a.rrf)
    .map((e) => ({ ...e.policy, score: e.maxScore })); // keep raw similarity in `score`
}
