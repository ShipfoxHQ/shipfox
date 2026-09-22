import {createOpenRouter} from '@openrouter/ai-sdk-provider';
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  tool,
  toUIMessageStream,
} from 'ai';
import {z} from 'zod';
import {config} from '@/config';
import type {AskAiMessage} from '@/lib/ask-ai-core';
import {searchDocumentation} from '@/lib/ask-ai-retrieval';

// An answer streams across several retrieval steps, which outlives the default
// serverless function timeout.
export const maxDuration = 60;

const MAX_STEPS = 5;

// An open-weight model is served by many providers at prices that differ several
// fold, so routing decides what the model ID actually buys. Declared low
// precision is excluded because it degrades tool-call formatting, which every
// answer depends on. `unknown` has to stay eligible: first-party models report it
// on every endpoint, so dropping it would leave a Claude fallback unroutable.
// `require_parameters` keeps the request away from a provider that ignores tools.
const PROVIDER_ROUTING = {
  quantizations: ['fp8', 'fp16', 'bf16', 'fp32', 'unknown'],
  require_parameters: true,
  sort: 'latency',
};

const INSTRUCTIONS = [
  'You answer questions about Shipfox, a platform that runs AI agent workflows on CI runners.',
  'Call the `search` tool before answering anything about the product. It returns whole documentation pages as Markdown.',
  'The index matches keywords, not sentences. Search for two or three terms, and search again with different terms when the pages you get back miss the question.',
  'Answer only from the pages you retrieved. When they do not cover the question, say so and point to the closest page.',
  'Cite every page you used as a Markdown link to its `url`.',
  'Keep answers short. Prefer a workflow YAML example over prose when the question is about authoring a workflow.',
  'Never invent a field name, step type, context variable, or CLI flag that the retrieved pages do not show.',
].join('\n');

const searchTool = tool({
  description:
    'Search the Shipfox documentation. Returns whole pages as Markdown, best match first.',
  inputSchema: z.object({
    query: z
      .string()
      .describe('Two or three keywords, such as "runner labels" or "cron schedule trigger".'),
  }),
  execute: ({query}) => searchDocumentation(query),
});

const chatRequestSchema = z.object({messages: z.array(z.unknown()).default([])});

export async function POST(request: Request) {
  const apiKey = config.OPENROUTER_API_KEY;
  if (!apiKey) return new Response('Ask AI is not configured on this deployment.', {status: 503});

  const {messages} = chatRequestSchema.parse(await request.json());
  const openrouter = createOpenRouter({apiKey});
  const result = streamText({
    model: openrouter.chat(config.ASK_AI_MODEL, {provider: PROVIDER_ROUTING}),
    instructions: INSTRUCTIONS,
    // `convertToModelMessages` validates the parts of every message it converts.
    messages: await convertToModelMessages<AskAiMessage>(messages as AskAiMessage[], {
      convertDataPart(part) {
        if (part.type === 'data-client')
          return {type: 'text', text: `[The reader is on ${part.data.location}]`};
      },
    }),
    tools: {search: searchTool},
    stopWhen: stepCountIs(MAX_STEPS),
  });

  return createUIMessageStreamResponse({stream: toUIMessageStream({stream: result.stream})});
}
