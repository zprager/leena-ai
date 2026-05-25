import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { REASON_CODES } from "@/lib/agent";
import type { EvalTicket } from "./types";

/**
 * Schema for fixtures/eval-50.json (or any compatible eval set). zod validates
 * the file at load time so a typo in a reason code or a missing field fails
 * loudly here instead of silently scoring everything as a mismatch.
 */
const groundTruthSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("RESOLVE"),
    citations: z.array(z.string().regex(/^POL-\d{2}\s§\d+\.\d+$/)).min(1),
    note: z.string(),
  }),
  z.object({
    action: z.literal("DEFER"),
    reasonCode: z.enum(REASON_CODES),
    note: z.string(),
  }),
]);

const evalTicketSchema = z.object({
  id: z.string().min(1),
  body: z.string().min(1),
  groundTruth: groundTruthSchema,
});

const evalSetSchema = z.array(evalTicketSchema).min(1);

/**
 * Load and validate an eval set from disk. Path is relative to the project
 * root (the harness CLI passes `fixtures/eval-50.json` by default).
 */
export async function loadEvalSet(path: string): Promise<EvalTicket[]> {
  const abs = resolve(process.cwd(), path);
  const raw = await readFile(abs, "utf8");
  const parsed: unknown = JSON.parse(raw);
  return evalSetSchema.parse(parsed);
}

/** Path used by the CLI when no `--file` is given. */
export const DEFAULT_EVAL_SET_PATH = "fixtures/eval-50.json";
