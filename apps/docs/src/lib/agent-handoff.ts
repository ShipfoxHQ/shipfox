import {getShippedSkillResource} from '@shipfox/workflow-templates';
import {AGENT_HANDOFF_LEAD_IN} from './agent-handoff-lead-in';
import type {MarkdownAudience} from './machine-readable';

const SKILL_URI_PREFIX = 'skill://shipfox/';
const SKILL_FILE_SUFFIX = '/SKILL.md';
const BACKTICK_RUN_PATTERN = /`+/g;
const WHITESPACE_PATTERN = /\s+/g;

export interface AgentHandoffInput {
  skill: string;
  prompt: string;
}

export function renderAgentHandoff({
  skill,
  prompt,
  audience,
}: AgentHandoffInput & {audience: MarkdownAudience}): string {
  const skillUri = agentHandoffSkillUri(skill);
  if (audience === 'human') {
    const fence = '`'.repeat(Math.max(3, longestBacktickRun(prompt) + 1));
    return [AGENT_HANDOFF_LEAD_IN, '', `${fence}text`, prompt, fence].join('\n');
  }

  return [
    '> **For coding agents:** The procedure for this task is the',
    `> \`${skill}\` skill,`,
    `> \`${skillUri}\`.`,
    `> Example request: "${prompt.trim().replace(WHITESPACE_PATTERN, ' ')}"`,
  ].join('\n');
}

/** Resolves a shipped skill to its MCP resource URI, so a renamed skill fails the build. */
export function agentHandoffSkillUri(skill: string): string {
  const resource = getShippedSkillResource(`${SKILL_URI_PREFIX}${skill}${SKILL_FILE_SUFFIX}`);
  if (!resource) {
    throw new Error(`AgentHandoff names a skill that is not shipped: ${skill}`);
  }
  return resource.uri;
}

function longestBacktickRun(value: string): number {
  return Math.max(0, ...[...value.matchAll(BACKTICK_RUN_PATTERN)].map((match) => match[0].length));
}
