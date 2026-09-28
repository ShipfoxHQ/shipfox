import type {WorkflowTemplate} from '#core/workflow-templates.js';

function template(
  fields: Omit<WorkflowTemplate, 'prompt' | 'startLabel'> & {startLabel?: string},
): WorkflowTemplate {
  return {
    startLabel: null,
    prompt: `Use Shipfox to create a workflow from the ${fields.id} template.`,
    ...fields,
  };
}

const TICKET_TO_PR = {
  id: 'ticket-to-pr',
  title: 'Task to pull request',
  summary: 'Turn a ticket or a request into a tested GitHub pull request.',
  providers: ['github', 'linear', 'jira'],
};
const ASK_CODEBASE = {
  id: 'ask-codebase',
  title: 'Ask the codebase in Slack',
  summary: 'Answer questions about your code in Slack, with references to the files.',
  providers: ['slack', 'github'],
};
const SLACK_TO_TICKET = {
  id: 'slack-to-ticket',
  title: 'Create a ticket from a Slack conversation',
  summary: 'Turn a request in a Slack thread into a Linear ticket grounded in your code.',
  providers: ['slack', 'linear', 'github'],
};
const FIX_DEFAULT_BRANCH_CI = {
  id: 'fix-default-branch-ci',
  title: 'Investigate and repair default-branch CI failures',
  summary: 'Find out why CI broke on your default branch and get a tested repair pull request.',
  providers: ['github', 'slack'],
  startLabel: 'Starts when CI fails on the default branch',
};
const FIX_DEPENDENCY_CI = {
  id: 'fix-dependency-ci',
  title: 'Repair failing pull request CI',
  summary: 'Get a tested fix when CI fails on a dependency update or an opted-in pull request.',
  providers: ['github'],
  startLabel: 'Starts on a failing dependency update',
};
const REPORT_FAILED_RUNS = {
  id: 'report-failed-runs',
  title: 'Report failed Shipfox workflow runs',
  summary:
    'Hear about every failed workflow run in Slack, with the failing step and an agent diagnosis of the cause.',
  providers: ['slack'],
  startLabel: 'Starts when a workflow run fails',
};

/** The library as ranked for a workspace with only GitHub connected. */
export const githubOnlyWorkflowTemplates: WorkflowTemplate[] = [
  template({...TICKET_TO_PR, group: 'try_now'}),
  template({...FIX_DEFAULT_BRANCH_CI, group: 'starts_on_event'}),
  template({...FIX_DEPENDENCY_CI, group: 'starts_on_event'}),
  template({...ASK_CODEBASE, group: 'needs_connection'}),
  template({...SLACK_TO_TICKET, group: 'needs_connection'}),
  template({...REPORT_FAILED_RUNS, group: 'needs_connection'}),
];

/** The library as ranked for a workspace with GitHub, Slack, and Linear connected. */
export const allToolsWorkflowTemplates: WorkflowTemplate[] = [
  template({...TICKET_TO_PR, group: 'try_now'}),
  template({...ASK_CODEBASE, group: 'try_now'}),
  template({...SLACK_TO_TICKET, group: 'try_now'}),
  template({...FIX_DEFAULT_BRANCH_CI, group: 'starts_on_event'}),
  template({...FIX_DEPENDENCY_CI, group: 'starts_on_event'}),
  template({...REPORT_FAILED_RUNS, group: 'starts_on_event'}),
];
