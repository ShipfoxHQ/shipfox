import type {RunnerToolCapabilitiesDto} from '@shipfox/api-runners-dto';
import {config} from '#config.js';
import {isPiExtensionAvailable} from '#core/pi-extensions.js';

const PI_BUILTIN_TOOLS = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'] as const;

const PI_WEB_ACCESS_TOOLS = ['web_search', 'fetch_content', 'get_search_content'] as const;

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
  const piTools = isPiExtensionAvailable({packageName: 'pi-web-access'})
    ? [...PI_BUILTIN_TOOLS, ...PI_WEB_ACCESS_TOOLS]
    : [...PI_BUILTIN_TOOLS];
  const features =
    config.SHIPFOX_RUNNER_ENABLE_RENEWABLE_GIT || config.SHIPFOX_RUNNER_ENABLE_RENEWABLE_INFERENCE
      ? {
          renewable_git: config.SHIPFOX_RUNNER_ENABLE_RENEWABLE_GIT,
          ...(config.SHIPFOX_RUNNER_ENABLE_RENEWABLE_INFERENCE
            ? {renewable_inference: true as const}
            : {}),
        }
      : undefined;

  return {
    ...(features === undefined ? {} : {features}),
    harnesses: {
      pi: {tools: piTools},
      claude: {tools: [...CLAUDE_TOOLS]},
    },
  };
}
