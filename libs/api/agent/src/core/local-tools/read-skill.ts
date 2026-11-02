import {
  getShippedSkillResource,
  listShippedSkillResources,
  type SkillResource,
} from '@shipfox/workflow-templates';

export interface AgentLocalToolResult {
  isError?: true;
  content: readonly {type: 'text'; text: string}[];
}

export interface AgentLocalTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input: Record<string, unknown>): AgentLocalToolResult;
}

const SKILL_URI_PREFIX = 'skill://shipfox/';

/**
 * A tool that runs inside Agent, with no provider call. A skill is embedded at build time, so
 * a read cannot reach anything outside the shipped skills.
 */
export function createReadSkillTool(): AgentLocalTool {
  const skills = listShippedSkillResources();
  return {
    name: 'read_skill',
    description: `Read a Shipfox skill, a procedure for a kind of task. Pass the URI of one of these skills:\n${skills.map(describeSkill).join('\n')}`,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {uri: {type: 'string', minLength: 1, maxLength: 256}},
      required: ['uri'],
    },
    execute: (input) => {
      const uri = input.uri;
      if (typeof uri !== 'string' || !uri.startsWith(SKILL_URI_PREFIX)) {
        return failure('Parameter uri must be a skill:// URI');
      }
      const resource = getShippedSkillResource(uri);
      return resource === undefined ? failure('Skill not found') : success(resource);
    },
  };
}

function describeSkill(skill: SkillResource): string {
  return `- ${skill.uri}: ${skill.description}`;
}

function success(resource: SkillResource): AgentLocalToolResult {
  return {content: [{type: 'text', text: resource.text}]};
}

function failure(message: string): AgentLocalToolResult {
  return {isError: true, content: [{type: 'text', text: message}]};
}
