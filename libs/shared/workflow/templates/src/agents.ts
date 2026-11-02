import {embeddedAgentPrompts} from './generated/assets.js';

/** The base prompt of a built-in agent, or undefined when no agent has that key. */
export function getBuiltInAgentPrompt(agentKey: string): string | undefined {
  return Object.hasOwn(embeddedAgentPrompts, agentKey) ? embeddedAgentPrompts[agentKey] : undefined;
}
