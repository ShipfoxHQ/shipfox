import type {RunnerToolCapabilitiesDto} from '@shipfox/api-runners-dto';

const PI_TOOLS = [
  'read',
  'bash',
  'edit',
  'write',
  'grep',
  'find',
  'ls',
  'web_search',
  'fetch_content',
  'get_search_content',
] as const;

const CLAUDE_TOOLS = [
  'Read',
  'Bash',
  'Edit',
  'Write',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch',
] as const;

export function runnerToolCapabilities(): RunnerToolCapabilitiesDto {
  return {
    harnesses: {
      pi: {tools: [...PI_TOOLS]},
      claude: {tools: [...CLAUDE_TOOLS]},
    },
  };
}
