import {createOpenRouter} from '@openrouter/ai-sdk-provider';
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  type ProviderMetadata,
  stepCountIs,
  streamText,
  tool,
  toUIMessageStream,
} from 'ai';
import {z} from 'zod';
import {config} from '@/config';
import type {AskAiMessage} from '@/lib/ask-ai-core';
import {documentationCatalog, readDocumentationPage} from '@/lib/ask-ai-retrieval';

// An answer streams across a few retrieval steps and a long reference page can
// take a while to prefill, which outlives the default serverless timeout.
export const maxDuration = 300;

const MAX_STEPS = 4;

// An open-weight model is served by many providers at prices and quality that
// differ several fold, so routing decides what the model ID actually buys.
// Declared low precision is excluded because it degrades tool-call formatting,
// which every answer depends on. `unknown` has to stay eligible: first-party
// models report it on every endpoint, so dropping it would leave a Claude
// fallback unroutable. `require_parameters` keeps the request away from a
// provider that ignores tools. Deliberately unsorted: ordering by latency
// selects for whichever endpoint answers fastest right now, which is the one
// most likely to be serving a degraded variant.
const PROVIDER_ROUTING = {
  quantizations: ['fp8', 'fp16', 'bf16', 'fp32', 'unknown'],
  require_parameters: true,
};

const INSTRUCTIONS = [
  'You answer questions about Shipfox, a platform that runs AI agent workflows on CI runners.',
  'The catalog below lists every documentation page with its path and what it covers.',
  'Pick the pages that cover the question and read them with the `read_page` tool before answering anything about the product. It returns a whole page as Markdown.',
  'Answer only from the pages you read. When they do not cover the question, say so and point to the closest page.',
  'Cite every page you used as a Markdown link to its catalog path, such as [Choose runners](/how-to/author-workflows/choose-runners).',
  'Keep answers short. Prefer a workflow YAML example over prose when the question is about authoring a workflow.',
  'Never invent a field name, step type, context variable, or CLI flag that the pages you read do not show.',
  '',
  '# Page catalog',
  '',
].join('\n');

const readPageTool = tool({
  description:
    'Read one Shipfox documentation page whole, as Markdown. Takes a path from the page catalog, such as "/integrations/linear/tools".',
  inputSchema: z.object({
    url: z.string().describe('A page path from the catalog, starting with "/".'),
  }),
  execute: ({url}) => readDocumentationPage(url),
});

const askAiTools = {read_page: readPageTool};

const chatRequestSchema = z.object({messages: z.array(z.unknown()).default([])});

function openRouterProvider(metadata: ProviderMetadata | undefined): string | undefined {
  const provider = metadata?.openrouter?.provider;
  return typeof provider === 'string' && provider.length > 0 ? provider : undefined;
}

export async function POST(request: Request) {
  const apiKey = config.OPENROUTER_API_KEY;
  if (!apiKey) return new Response('Ask AI is not configured on this deployment.', {status: 503});

  const {messages} = chatRequestSchema.parse(await request.json());
  const openrouter = createOpenRouter({apiKey});

  // Collected across steps so the finish chunk can report which endpoint served
  // the answer and how much of the step budget it took.
  let servingProvider: string | undefined;
  let steps = 0;

  const result = streamText({
    model: openrouter.chat(config.ASK_AI_MODEL, {provider: PROVIDER_ROUTING}),
    instructions: `${INSTRUCTIONS}${documentationCatalog()}`,
    // `convertToModelMessages` validates the parts of every message it converts.
    messages: await convertToModelMessages<AskAiMessage>(messages as AskAiMessage[], {
      convertDataPart(part) {
        if (part.type === 'data-client')
          return {type: 'text', text: `[The reader is on ${part.data.location}]`};
      },
    }),
    tools: askAiTools,
    stopWhen: stepCountIs(MAX_STEPS),
    // Without this the run can spend its last step on a tool call and end with
    // no text at all, which reaches the reader as a silent non-answer.
    prepareStep: ({stepNumber}) => (stepNumber >= MAX_STEPS - 1 ? {toolChoice: 'none'} : undefined),
    onStepEnd: ({providerMetadata}) => {
      steps += 1;
      servingProvider = openRouterProvider(providerMetadata) ?? servingProvider;
    },
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream<typeof askAiTools, AskAiMessage>({
      stream: result.stream,
      messageMetadata: ({part}) =>
        part.type === 'finish'
          ? {finish_reason: part.finishReason, provider: servingProvider, steps}
          : undefined,
    }),
  });
}
