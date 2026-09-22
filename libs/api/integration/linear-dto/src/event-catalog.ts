import type {IntegrationEventCatalog} from '@shipfox/api-integration-core-dto';
import {
  linearAgentSessionWebhookEventNames,
  linearWebhookActions,
  linearWebhookResourceTypes,
} from './schemas/index.js';

const linearWebhookDocsUrl = 'https://linear.app/developers/webhooks';
const linearAgentInteractionDocsUrl = 'https://linear.app/developers/agent-interaction';

const resourceLabels = {
  Issue: 'issue',
  Comment: 'comment',
  IssueLabel: 'issue label',
  Project: 'project',
  Cycle: 'cycle',
} as const satisfies Record<(typeof linearWebhookResourceTypes)[number], string>;

const dataEventSummaryByAction = {
  create: 'is created.',
  update: 'changes.',
  remove: 'is removed.',
} as const satisfies Record<(typeof linearWebhookActions)[number], string>;

const agentSessionSummaries = {
  'agentSession.created': 'A Linear agent session is created.',
  'agentSession.prompted': 'A user adds a prompt to a Linear agent session.',
} as const satisfies Record<(typeof linearAgentSessionWebhookEventNames)[number], string>;

const familyTitles = {
  Issue: 'Issues',
  Comment: 'Comments',
  IssueLabel: 'Issue labels',
  Project: 'Projects',
  Cycle: 'Cycles',
} as const satisfies Record<(typeof linearWebhookResourceTypes)[number], string>;

export const linearEventCatalog = {
  provider: 'Linear',
  families: [
    ...linearWebhookResourceTypes.map((type) => ({
      key: type,
      title: familyTitles[type],
      summary: `Changes to a Linear ${resourceLabels[type]}. The event includes the type, the action, and the ${resourceLabels[type]} itself under data.`,
      payloadKind: 'raw-provider' as const,
      payloadDocUrl: linearWebhookDocsUrl,
    })),
    {
      key: 'agentSession',
      title: 'Agent sessions',
      summary:
        'Requests from Linear to the connected agent. The event includes the session and the prompt.',
      payloadKind: 'raw-provider' as const,
      payloadDocUrl: linearAgentInteractionDocsUrl,
    },
  ],
  events: [
    ...linearWebhookResourceTypes.flatMap((type) =>
      linearWebhookActions.map((action) => ({
        name: `${type}.${action}`,
        family: type,
        summary: dataEventSummary(resourceLabels[type], action),
      })),
    ),
    ...linearAgentSessionWebhookEventNames.map((name) => ({
      name,
      family: 'agentSession',
      summary: agentSessionSummaries[name],
    })),
  ],
} as const satisfies IntegrationEventCatalog;

function dataEventSummary(resource: string, action: (typeof linearWebhookActions)[number]): string {
  return `A Linear ${resource} ${dataEventSummaryByAction[action]}`;
}
