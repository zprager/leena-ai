import "dotenv/config";
import { z } from "zod";

/**
 * dotenv parses `FOO=` (empty value) as the empty string, not undefined.
 * For optional fields that ALSO have a format constraint (.url(), .email()),
 * that means an empty .env line fails the format check instead of being
 * treated as "not set". Wrap those fields so the empty string collapses to
 * undefined before the format check runs.
 */
function optionalEmpty<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    schema.optional(),
  );
}

// Centralized env access. Anything that touches process.env should go through here
// so we get a single failure mode (clear error at boot) instead of undefined surprises.
const schema = z.object({
  LLM_PROVIDER: z.enum(["anthropic", "openai"]).default("anthropic"),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-4-6"),
  OPENAI_MODEL: z.string().default("gpt-4o"),

  EMBEDDING_PROVIDER: z.enum(["openai"]).default("openai"),
  EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  EMBEDDING_DIM: z.coerce.number().int().positive().default(1536),

  QDRANT_URL: z.string().url().default("http://localhost:6333"),
  QDRANT_API_KEY: z.string().optional(),
  QDRANT_COLLECTION: z.string().default("helix_policies"),

  // --- Retrieval tuning ---
  // top-k pulled from the vector store per query
  RETRIEVAL_TOP_K: z.coerce.number().int().positive().default(5),
  // Cosine similarity floor for "confident enough to RESOLVE". Below this the
  // agent should DEFER as LOW_CONFIDENCE. Calibrated via `npm run sweep`
  // against the 50-ticket eval set — 0.30 scored 100% (zero false_resolve,
  // zero missed_resolve) on the baseline run. See reports/sweeps/ for history.
  RETRIEVAL_SCORE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.30),
  // For multi-query fusion: how many paraphrases to generate (in addition to
  // the original query).
  RETRIEVAL_QUERY_VARIANTS: z.coerce.number().int().min(0).max(5).default(2),

  // --- Reranking (Cohere) ---
  // Opt-in cross-encoder rerank on top of cosine retrieval. At this corpus
  // size (60 chunks) the sweep showed it doesn't move the score — kept here
  // as a future-proofing knob for when the corpus grows or the eval set
  // gets more adversarial.
  COHERE_API_KEY: optionalEmpty(z.string()),
  // Anything truthy ("true"/"1"/"yes") flips it on. `optionalEmpty` lets a
  // blank line in .env mean "unset" instead of failing the zod check.
  RAG_RERANK_ENABLED: z.preprocess(
    (v) => v === "true" || v === "1" || v === "yes",
    z.boolean(),
  ),
  RERANK_MODEL: z.string().default("rerank-v3.5"),
  // How many cosine top-K to pull from Qdrant *before* reranking. The
  // reranker reads all of them, scores each with a cross-encoder, and we
  // keep RETRIEVAL_TOP_K of the top-rated.
  RERANK_CANDIDATE_K: z.coerce.number().int().positive().default(20),

  // --- JIRA connector (optional) ---
  // The triage pipeline runs fine without these; the JIRA poller/webhook
  // checks `buildClientFromEnv()` and no-ops if they're missing. When you do
  // set them, JIRA_BASE_URL + JIRA_EMAIL + JIRA_API_TOKEN are the minimum.
  JIRA_BASE_URL: optionalEmpty(z.string().url()),
  JIRA_EMAIL: optionalEmpty(z.string().email()),
  JIRA_API_TOKEN: z.string().optional(),
  JIRA_PROJECT_KEY: z.string().optional(),
  // Overrides the default JQL ("project = <KEY> AND status = 'Waiting for triage'").
  JIRA_QUEUE_JQL: z.string().optional(),
  JIRA_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
  // Transition ids are workflow-specific; discover via
  //   GET /rest/api/3/issue/{key}/transitions
  // or `listTransitions(client, key)` from this module.
  JIRA_RESOLVE_TRANSITION_ID: z.string().optional(),
  JIRA_DEFER_TRANSITION_ID: z.string().optional(),
  // Shared secret HMAC for webhook verification (optional).
  JIRA_WEBHOOK_SECRET: z.string().optional(),
  // Atlassian-account email to assign triaged tickets to (RESOLVE and DEFER).
  // Resolved to accountId once per run via findUserByEmail; if unset, the
  // write-back path skips assignment and the ticket stays Unassigned.
  JIRA_ASSIGNEE_EMAIL: optionalEmpty(z.string().email()),
});

export const env = schema.parse(process.env);
export type Env = typeof env;
