import type {TemplateFlowStep, TemplateGroup, TemplateIcon} from './types';

// Page metadata the template manifests do not carry.
export interface AuthoredMetadata {
  group: TemplateGroup;
  starts: string;
  flow: TemplateFlowStep[];
  writes: {icon: TemplateIcon; action: string}[];
  /** User actions on Cloud only. Permissions and runner tools are Shipfox's job. */
  prerequisites: string[];
  upcoming?: Record<string, TemplateIcon[]>;
  related?: string[];
}

export const authoredTemplateMetadata: Record<string, AuthoredMetadata> = {
  'ticket-to-pr': {
    group: 'deliver',
    starts: 'Another workflow sends a task, or you assign the agent to a Linear issue',
    upcoming: {tracker: ['jira', 'clickup', 'github']},
    flow: [
      {
        kind: 'trigger',
        title: 'The agent gets a task',
        detail:
          'Another workflow, such as a Slack dispatcher, sends the task with its acceptance criteria. Optional: assign the agent to a Linear issue, mention it, or add a label.',
      },
      {
        kind: 'agent',
        title: 'The agent changes the code',
        detail:
          'It reads the task and the repository. Then it makes the smallest change, or asks questions when the task is unclear.',
      },
      {
        kind: 'check',
        title: 'The workflow runs your tests',
        detail: 'If a test fails, the workflow sends the log to the agent.',
        loopsTo: 1,
      },
      {
        kind: 'write',
        icon: 'github',
        title: 'The workflow opens a draft pull request',
        detail:
          'The starting workflow reads the PR link or the questions of the agent. With Linear, the workflow also comments on the issue.',
      },
      {
        kind: 'human',
        title: 'You review and merge the pull request',
        detail: 'Optional: the agent replies to inline review comments and fixes failed CI.',
      },
    ],
    writes: [
      {icon: 'github', action: 'Pushes a branch and opens a draft pull request'},
      {icon: 'github', action: 'Replies to review threads and resolves them (feedback loop only)'},
      {icon: 'linear', action: 'Comments on the issue and can change its status (optional)'},
    ],
    prerequisites: [
      'Connect GitHub.',
      'Run CI on GitHub Actions to use the feedback loop.',
      'To start from Linear issues, connect Linear.',
    ],
    related: ['fix-dependency-ci', 'report-failed-runs'],
  },
  'fix-dependency-ci': {
    group: 'deliver',
    starts: 'CI fails on a dependency-bot pull request',
    flow: [
      {
        kind: 'trigger',
        icon: 'github',
        title: 'A dependency update fails CI',
        detail: 'Dependabot or Renovate opens a pull request, and a check fails.',
      },
      {
        kind: 'agent',
        title: 'The agent finds the cause',
        detail: 'It reads the failed logs and the changes in the update.',
      },
      {
        kind: 'check',
        title: 'The workflow runs your checks again',
        detail: 'The checks confirm that the fix works.',
      },
      {
        kind: 'write',
        icon: 'github',
        title: 'The workflow pushes the fix or proposes it',
        detail: 'It pushes to the branch of the bot, or it posts a patch as a comment.',
      },
    ],
    writes: [{icon: 'github', action: 'Pushes to the bot branch or comments with a patch'}],
    prerequisites: [
      'Connect GitHub.',
      'Run CI on GitHub Actions, with Dependabot or Renovate opening update pull requests.',
      'To push fixes, let the Shipfox app commit to the branches of the bot.',
    ],
    related: ['fix-default-branch-ci'],
  },
  'fix-default-branch-ci': {
    group: 'deliver',
    starts: 'CI fails on the default branch',
    flow: [
      {
        kind: 'trigger',
        icon: 'github',
        title: 'CI fails on the default branch',
        detail: 'A GitHub Actions run fails on main.',
      },
      {
        kind: 'agent',
        title: 'The agent finds the cause',
        detail: 'It reads the failed logs and the recent changes on the branch.',
      },
      {
        kind: 'write',
        icon: 'github',
        title: 'The agent opens a repair pull request',
        detail:
          'It opens a pull request only when it can fix the cause and your checks pass. If the cause is outside your code, such as a registry outage, it does nothing.',
      },
      {
        kind: 'write',
        icon: 'slack',
        title: 'Optional: you are notified on Slack',
        detail:
          'The workflow posts a message for each repair, or for each failure that needs a person.',
      },
    ],
    writes: [
      {icon: 'github', action: 'Opens a repair pull request'},
      {icon: 'slack', action: 'Posts a report (optional)'},
    ],
    prerequisites: [
      'Connect GitHub.',
      'Run CI on GitHub Actions on pushes or schedules to the default branch.',
      'For the Slack report, connect Slack and invite the Shipfox app to the report channel.',
    ],
    related: ['fix-dependency-ci', 'report-failed-runs'],
  },
  'ask-codebase': {
    group: 'bring-in',
    starts: 'Someone mentions the Shipfox app in Slack',
    flow: [
      {
        kind: 'trigger',
        icon: 'slack',
        title: 'Someone asks a question in Slack',
        detail: 'They mention the Shipfox app in a channel.',
      },
      {
        kind: 'agent',
        title: 'The agent reads the thread and the code',
        detail: 'It reads the default branch and changes nothing.',
      },
      {
        kind: 'write',
        icon: 'slack',
        title: 'The agent replies in the thread',
        detail: 'It links the files it read and says when it is not sure.',
      },
    ],
    writes: [{icon: 'slack', action: 'Replies in the thread'}],
    prerequisites: [
      'Connect GitHub and Slack.',
      'Invite the Shipfox app to each channel where it answers.',
    ],
  },
  'report-failed-runs': {
    group: 'operate',
    starts: 'A Shipfox workflow run fails',
    flow: [
      {
        kind: 'trigger',
        icon: 'shipfox',
        title: 'A workflow run fails',
        detail: 'The workflow watches every workflow in the project.',
      },
      {
        kind: 'tool',
        icon: 'shipfox',
        title: 'The workflow reads the failed run',
        detail: 'It gets the failed jobs and steps, the first error, and the last 15 log lines.',
      },
      {
        kind: 'write',
        icon: 'slack',
        title: 'You get a report on Slack',
        detail:
          'The report suggests a next step. Optional: an agent adds a diagnosis in the thread.',
      },
    ],
    writes: [{icon: 'slack', action: 'Posts a message for each failed run'}],
    prerequisites: ['Connect Slack and invite the Shipfox app to the report channel.'],
    related: ['fix-default-branch-ci'],
  },
};
