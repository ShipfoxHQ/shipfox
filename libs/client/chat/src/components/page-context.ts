import type {AgentPageContext} from '@shipfox/client-shell/runtime';

/** Chosen by the page, and shown only in an empty conversation. They don't send until clicked. */
export function suggestedPrompts(context: AgentPageContext | undefined): string[] {
  switch (context?.page) {
    case 'run':
      return [context.status === 'failed' ? 'Why did this run fail?' : 'Summarize this run'];
    case 'job':
      return ['What happened in this job?'];
    case 'workflows':
      return ['What does each workflow do?', 'Which workflow can you start for me?'];
    case 'workflow':
      return ['Explain this workflow', 'Start this workflow'];
    case 'runs':
      return ['What failed recently?', 'Which workflow can you start for me?'];
    default:
      return [];
  }
}

/** What the agent sees, so the reader sees it too. */
export function pageContextLabel(context: AgentPageContext | undefined): string | undefined {
  switch (context?.page) {
    case 'runs':
      return 'Viewing runs';
    case 'run':
      return `Viewing ${runLabel(context.runNumber)}`;
    case 'job':
      return `Viewing a job in ${runLabel(context.runNumber)}`;
    case 'workflows':
      return 'Viewing automations';
    case 'workflow':
      return context.name ? `Viewing ${context.name}` : 'Viewing a workflow';
    case 'project_settings':
      return 'Viewing project settings';
    default:
      return undefined;
  }
}

function runLabel(runNumber: number | undefined): string {
  return runNumber === undefined ? 'a run' : `run #${runNumber}`;
}
