import { z } from "zod";
import { REASON_CODES, type ReasonCode } from "./reason-codes";

/**
 * Schema we ask the LLM to fill. We keep it FLAT (nullable fields instead of
 * a discriminated union) because flat schemas round-trip reliably across both
 * Anthropic's tool-use backend and OpenAI's structured-output strict mode.
 *
 * IMPORTANT: every field is required (no `.optional()`), but action-irrelevant
 * fields are nullable. OpenAI strict mode requires every property in the
 * `required` array — `optional` causes:
 *   "'required' is required to be supplied and to be an array including
 *    every key in properties. Missing 'citation'."
 * With `.nullable()` (no .optional()), the LLM must always emit the field,
 * just sets it to null when the action doesn't apply. normalizeTriageOutput
 * collapses both shapes.
 */
export const triageOutputSchema = z.object({
  action: z
    .enum(["RESOLVE", "DEFER"])
    .describe("RESOLVE = auto-answer with a grounded citation. DEFER = leave for a human."),
  citation: z
    .string()
    .nullable()
    .describe(
      'For RESOLVE: exact citation like "POL-02 §2.3" matching one of the [POL-XX §X.X] markers in the provided policy context. Null when action=DEFER.',
    ),
  answer: z
    .string()
    .nullable()
    .describe(
      "For RESOLVE: the friendly, user-facing answer grounded in the cited section. Null when action=DEFER.",
    ),
  reasonCode: z
    .enum(REASON_CODES)
    .nullable()
    .describe("For DEFER: one of the 12 standardized reason codes. Null when action=RESOLVE."),
  note: z
    .string()
    .nullable()
    .describe(
      "For DEFER: brief note for the human reviewer about why this was deferred. Null when action=RESOLVE.",
    ),
  reasoning: z
    .string()
    .describe("One-sentence internal note on why this classification — not shown to the user."),
});

export type TriageOutput = z.infer<typeof triageOutputSchema>;

/**
 * What the rest of the system consumes. Discriminated on `action` so a
 * RESOLVE necessarily has citation + answer and a DEFER necessarily has
 * reasonCode — no optional-juggling at call sites.
 */
export type TriageDecision =
  | {
      action: "RESOLVE";
      citation: string;
      answer: string;
      reasoning: string;
    }
  | {
      action: "DEFER";
      reasonCode: ReasonCode;
      note: string;
      reasoning: string;
    };

/**
 * Narrow a flat LLM output into the discriminated union. Anything malformed
 * (RESOLVE with no citation, DEFER with no reasonCode, etc.) collapses to a
 * LOW_CONFIDENCE DEFER rather than throwing — better than letting a junk
 * shape leak through to the JIRA comment.
 */
export function normalizeTriageOutput(o: TriageOutput): TriageDecision {
  if (o.action === "RESOLVE") {
    if (!o.citation || !o.answer) {
      return {
        action: "DEFER",
        reasonCode: "LOW_CONFIDENCE",
        note: "Agent produced a RESOLVE with missing citation or answer.",
        reasoning: o.reasoning,
      };
    }
    return {
      action: "RESOLVE",
      citation: o.citation,
      answer: o.answer,
      reasoning: o.reasoning,
    };
  }
  // DEFER
  if (!o.reasonCode) {
    return {
      action: "DEFER",
      reasonCode: "LOW_CONFIDENCE",
      note: o.note ?? "Agent deferred without a reason code.",
      reasoning: o.reasoning,
    };
  }
  return {
    action: "DEFER",
    reasonCode: o.reasonCode,
    note: o.note ?? "Routing to human.",
    reasoning: o.reasoning,
  };
}
