import { PrismaClient } from "@prisma/client";

// This list mirrors the one in scripts/seed-ai-models.ts. Keeping it here allows
// the application to self-heal at startup without requiring a manual script run.
const DEFAULT_MODELS = [
  {
    id: "groq/llama-3.1-8b-instant",
    displayName: "Llama 3.1 8B",
    provider: "Groq",
    isFree: true,
  },
  {
    id: "groq/llama-3.3-70b-versatile",
    displayName: "Llama 3.3 70B",
    provider: "Groq",
    isFree: true,
  },
  {
    id: "groq/mixtral-8x7b-32768",
    displayName: "Mixtral 8x7B",
    provider: "Groq",
    isFree: true,
  },
  {
    id: "groq/gemma2-9b-it",
    displayName: "Gemma 2 9B",
    provider: "Groq",
    isFree: true,
  },
  {
    id: "gemini/gemini-1.5-flash",
    displayName: "Gemini 1.5 Flash",
    provider: "Google",
    isFree: true,
  },
  {
    id: "gemini/gemini-2.0-flash",
    displayName: "Gemini 2.0 Flash",
    provider: "Google",
    isFree: true,
  },
  {
    id: "mistral/open-mistral-7b",
    displayName: "Mistral 7B",
    provider: "Mistral",
    isFree: true,
  },
  {
    id: "mistral/mistral-small-latest",
    displayName: "Mistral Small",
    provider: "Mistral",
    isFree: true,
  },
  {
    id: "openrouter/meta-llama/llama-3.1-8b-instruct:free",
    displayName: "Llama 3.1 8B (OR)",
    provider: "OpenRouter",
    isFree: true,
  },
  {
    id: "openai/gpt-4o-mini",
    displayName: "GPT-4o Mini",
    provider: "OpenAI",
    isFree: false,
  },
];

export async function seedAIModels(prisma: PrismaClient) {
  for (const m of DEFAULT_MODELS) {
    await prisma.aiModel.upsert({
      where: { id: m.id },
      create: { ...m, isEnabled: true },
      update: {
        displayName: m.displayName,
        provider: m.provider,
        isFree: m.isFree,
        isEnabled: true,
      },
    });
  }
}
