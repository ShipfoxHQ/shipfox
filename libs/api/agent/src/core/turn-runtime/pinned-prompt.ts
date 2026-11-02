import {getBuiltInAgentPrompt} from '@shipfox/workflow-templates';

/**
 * The text of the pinned system entry: the agent's base prompt, then a short project header.
 * The project name is user-chosen, so it is quoted as data. It holds no live list of workflows
 * or connections, because the agent reads those through tools.
 */
export function buildPinnedPrompt(params: {
  agentKey: string;
  projectId: string;
  projectName: string;
}): string {
  const base = getBuiltInAgentPrompt(params.agentKey);
  if (base === undefined) throw new Error(`No built-in prompt for agent "${params.agentKey}"`);
  return `${base.trimEnd()}\n\n## This conversation\n\nProject: ${JSON.stringify(params.projectName)} (id ${params.projectId})\n`;
}
