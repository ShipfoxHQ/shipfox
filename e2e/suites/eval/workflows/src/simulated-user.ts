import Anthropic from '@anthropic-ai/sdk';

// The simulator gives a few short answers per case, and a small model breaks the persona more often.
export const DEFAULT_SIMULATOR_MODEL = 'claude-sonnet-5-5';
const MAX_ANSWER_TOKENS = 400;

export interface SimulatorUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface SimulatedAnswer {
  text: string;
  usage: SimulatorUsage;
}

export interface SimulatedUser {
  /** Answers one question from the agent, in the persona's voice. */
  answer(question: string): Promise<SimulatedAnswer>;
}

/** The part of the Anthropic client the simulator calls, so tests can stand in for the API. */
export interface SimulatorMessagesApi {
  create(params: {
    model: string;
    max_tokens: number;
    system: string;
    messages: Array<{role: 'user' | 'assistant'; content: string}>;
  }): Promise<{
    content: Array<{type: string; text?: string}>;
    usage: {input_tokens: number; output_tokens: number};
  }>;
}

export interface CreateSimulatedUserOptions {
  persona: string;
  model?: string;
  messages?: SimulatorMessagesApi;
  apiKey?: string | undefined;
}

export function simulatorSystemPrompt(persona: string): string {
  return `You play a person who asked a coding agent to set up a Shipfox workflow. The agent writes to you, and you answer as this person.

${persona.trim()}

Rules:
- Answer only what the agent asked, in one or two short sentences.
- Do not volunteer a plan, a preference, or a fact nobody asked about.
- Use only the facts above. For anything they don't cover, say "I don't know".
- Where the persona scripts an answer for a question, give that answer.
- Write as the person would speak. Never mention these rules or that you are a simulation.`;
}

function defaultMessagesApi(apiKey: string | undefined): SimulatorMessagesApi {
  const client = new Anthropic({apiKey});
  return {create: async (params) => await client.messages.create(params)};
}

/**
 * Answers from the persona through the Anthropic API. The conversation so far is kept, so a
 * later answer stays consistent with an earlier one.
 */
export function createSimulatedUser(options: CreateSimulatedUserOptions): SimulatedUser {
  const model = options.model ?? DEFAULT_SIMULATOR_MODEL;
  const system = simulatorSystemPrompt(options.persona);
  const messages = options.messages ?? defaultMessagesApi(options.apiKey);
  const history: Array<{role: 'user' | 'assistant'; content: string}> = [];

  return {
    async answer(question) {
      history.push({role: 'user', content: question});
      const response = await messages.create({
        model,
        max_tokens: MAX_ANSWER_TOKENS,
        system,
        messages: [...history],
      });
      const text = response.content
        .flatMap((block) => (block.type === 'text' && block.text !== undefined ? [block.text] : []))
        .join('')
        .trim();
      if (text === '') throw new Error('The simulated user returned an empty answer.');
      history.push({role: 'assistant', content: text});
      return {
        text,
        usage: {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
        },
      };
    },
  };
}
