import { PrismaClient } from '@prisma/client';

const models = [
  { id: 'groq/llama-3.1-8b-instant',                        displayName: 'Llama 3.1 8B',       provider: 'Groq',       isFree: true },
  { id: 'groq/llama-3.3-70b-versatile',                     displayName: 'Llama 3.3 70B',      provider: 'Groq',       isFree: true },
  { id: 'groq/mixtral-8x7b-32768',                          displayName: 'Mixtral 8x7B',       provider: 'Groq',       isFree: true },
  { id: 'groq/gemma2-9b-it',                                displayName: 'Gemma 2 9B',         provider: 'Groq',       isFree: true },
  { id: 'gemini/gemini-1.5-flash',                          displayName: 'Gemini 1.5 Flash',   provider: 'Google',     isFree: true },
  { id: 'gemini/gemini-2.0-flash',                          displayName: 'Gemini 2.0 Flash',   provider: 'Google',     isFree: true },
  { id: 'mistral/open-mistral-7b',                          displayName: 'Mistral 7B',         provider: 'Mistral',    isFree: true },
  { id: 'mistral/mistral-small-latest',                     displayName: 'Mistral Small',      provider: 'Mistral',    isFree: true },
  { id: 'openrouter/meta-llama/llama-3.1-8b-instruct:free', displayName: 'Llama 3.1 8B (OR)',  provider: 'OpenRouter', isFree: true },
  { id: 'openai/gpt-4o-mini',                               displayName: 'GPT-4o Mini',        provider: 'OpenAI',     isFree: false },
];

async function main() {
  const p = new PrismaClient();
  try {
    for (const m of models) {
      await p.aiModel.upsert({
        where:  { id: m.id },
        create: m,
        update: { displayName: m.displayName, provider: m.provider, isFree: m.isFree },
      });
      console.log('  ✔ seeded', m.id);
    }
    console.log(`\nDone — seeded ${models.length} AI models into ai_models table`);
  } finally {
    await p.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

