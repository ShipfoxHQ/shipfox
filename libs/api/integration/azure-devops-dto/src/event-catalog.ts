import type {IntegrationEventCatalog} from '@shipfox/api-integration-core-dto';
import {azureDevOpsWebhookEventNames} from './schemas/index.js';

const serviceHooksDocsUrl =
  'https://learn.microsoft.com/azure/devops/service-hooks/events?view=azure-devops';

const eventSummaries = {
  'git.push': 'Commits are pushed to a branch or tag of an Azure Repos repository.',
  'git.pullrequest.created': 'A pull request is created.',
  'git.pullrequest.updated': 'A pull request changes: new commits, status, reviewers or votes.',
  'git.pullrequest.merged': 'A pull request merge is attempted.',
  'ms.vss-code.git-pullrequest-comment-event': 'A comment is added to a pull request.',
  'build.complete': 'An Azure Pipelines build completes.',
} as const satisfies Record<(typeof azureDevOpsWebhookEventNames)[number], string>;

const families = {
  'git.push': 'push',
  'git.pullrequest.created': 'pull_request',
  'git.pullrequest.updated': 'pull_request',
  'git.pullrequest.merged': 'pull_request',
  'ms.vss-code.git-pullrequest-comment-event': 'pull_request',
  'build.complete': 'build',
} as const satisfies Record<(typeof azureDevOpsWebhookEventNames)[number], string>;

export const azureDevOpsEventCatalog = {
  provider: 'Azure DevOps',
  families: [
    {
      key: 'push',
      title: 'Push',
      summary: 'Commits pushed to a branch or tag in the connected organization.',
      payloadKind: 'raw-provider',
      payloadDocUrl: serviceHooksDocsUrl,
    },
    {
      key: 'pull_request',
      title: 'Pull requests',
      summary: 'Pull requests and their comments. The payload is the Service Hook notification.',
      payloadKind: 'raw-provider',
      payloadDocUrl: serviceHooksDocsUrl,
    },
    {
      key: 'build',
      title: 'Builds',
      summary: 'Completed Azure Pipelines builds. The payload is the Service Hook notification.',
      payloadKind: 'raw-provider',
      payloadDocUrl: serviceHooksDocsUrl,
    },
  ],
  events: azureDevOpsWebhookEventNames.map((name) => ({
    name,
    family: families[name],
    summary: eventSummaries[name],
  })),
} as const satisfies IntegrationEventCatalog;
