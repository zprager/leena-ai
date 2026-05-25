import { openai } from "@ai-sdk/openai";
import { embed, embedMany, type EmbeddingModel } from "ai";
import { env } from "@/lib/env";

// Anthropic does not ship an embeddings model. If we ever want an
// Anthropic-aligned stack we'd plug Voyage AI in here behind the same interface.
function resolveEmbeddingModel(): EmbeddingModel {
  switch (env.EMBEDDING_PROVIDER) {
    case "openai": {
      if (!env.OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY is not set (required for embeddings)");
      }
      return openai.embedding(env.EMBEDDING_MODEL);
    }
  }
}

export async function embedText(text: string): Promise<number[]> {
  const { embedding } = await embed({
    model: resolveEmbeddingModel(),
    value: text,
  });
  return embedding;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const { embeddings } = await embedMany({
    model: resolveEmbeddingModel(),
    values: texts,
  });
  return embeddings;
}

export const EMBEDDING_DIM = env.EMBEDDING_DIM;
