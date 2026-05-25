import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import {
  generateText,
  streamText,
  generateObject,
  type ModelMessage,
  type LanguageModel,
} from "ai";
import type { z } from "zod";
import { env } from "@/lib/env";

export type LLMProvider = "anthropic" | "openai";

export interface ChatOptions {
  /** Override the default provider for this call. */
  provider?: LLMProvider;
  /** Override the default model id for the chosen provider. */
  model?: string;
  system?: string;
  /** Pass exactly one of `messages` or `prompt`. */
  messages?: ModelMessage[];
  prompt?: string;
  temperature?: number;
  /** Note: AI SDK v6 renamed this from `maxTokens`. */
  maxOutputTokens?: number;
  // Tool calling — passed through to the AI SDK. Typed loosely so callers
  // can pass their own tool definitions without us re-exporting v6 generics.
  tools?: Record<string, unknown>;
  toolChoice?: "auto" | "required" | "none" | { type: "tool"; toolName: string };
}

function resolveModel(provider: LLMProvider, modelId?: string): LanguageModel {
  switch (provider) {
    case "anthropic": {
      if (!env.ANTHROPIC_API_KEY) {
        throw new Error("ANTHROPIC_API_KEY is not set");
      }
      return anthropic(modelId ?? env.ANTHROPIC_MODEL);
    }
    case "openai": {
      if (!env.OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY is not set");
      }
      return openai(modelId ?? env.OPENAI_MODEL);
    }
  }
}

function pickProvider(opts: ChatOptions): LLMProvider {
  return opts.provider ?? (env.LLM_PROVIDER as LLMProvider);
}

/**
 * Build the args object, picking either {messages} or {prompt} so we satisfy
 * the AI SDK v6 discriminated union without forcing callers to know about it.
 */
function buildArgs(opts: ChatOptions, model: LanguageModel) {
  const base = {
    model,
    system: opts.system,
    temperature: opts.temperature,
    maxOutputTokens: opts.maxOutputTokens,
  };
  if (opts.messages && opts.messages.length > 0) {
    return { ...base, messages: opts.messages };
  }
  if (typeof opts.prompt === "string") {
    return { ...base, prompt: opts.prompt };
  }
  throw new Error("chat(): provide either `messages` or `prompt`");
}

/** One-shot text generation. */
export async function chat(opts: ChatOptions) {
  const model = resolveModel(pickProvider(opts), opts.model);
  return generateText({
    ...buildArgs(opts, model),
    tools: opts.tools as never,
    toolChoice: opts.toolChoice as never,
  });
}

/** Streaming text generation — return as-is so callers can pipe to a Response. */
export function chatStream(opts: ChatOptions) {
  const model = resolveModel(pickProvider(opts), opts.model);
  return streamText({
    ...buildArgs(opts, model),
    tools: opts.tools as never,
    toolChoice: opts.toolChoice as never,
  });
}

/** Structured output — the agent's decision schema goes through here. */
export async function chatObject<T>(opts: ChatOptions & { schema: z.ZodType<T> }) {
  const model = resolveModel(pickProvider(opts), opts.model);
  return generateObject({
    ...buildArgs(opts, model),
    schema: opts.schema,
  });
}
