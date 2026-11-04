import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import {conversationFactory} from '#test/factories/conversation.js';
import {routeInteraction} from '../interaction-routing.js';
import {reportConversationRunLink} from './run-link-progress.js';

const link = {label: 'Deploy', url: 'https://app.shipfox.test/runs/1'};

function fakeIntegrations() {
  const reportInteractionProgress = vi.fn().mockResolvedValue({reported: true});
  const client = {reportInteractionProgress} as unknown as Pick<
    IntegrationsModuleClient,
    'reportInteractionProgress'
  >;
  return {client, reportInteractionProgress};
}

async function routeSlackRequest() {
  const workspaceId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const connectionId = crypto.randomUUID();
  const conversationKey = 'C1:1700000000.000100';
  const routed = await routeInteraction(
    {
      workspaceId,
      connectionId,
      provider: 'slack',
      deliveryKey: crypto.randomUUID(),
      interaction: {conversationKey, role: 'request', text: 'Deploy it'},
    },
    {
      projects: {
        getDefaultProject: vi.fn().mockResolvedValue({project: {id: projectId}}),
        getProjectAccessPolicy: vi.fn().mockResolvedValue({
          policy: {
            projectId,
            configSource: {
              managed: true,
              connectionId: crypto.randomUUID(),
              externalRepositoryId: 'managed:repository',
              lookupName: null,
            },
            connections: 'all',
          },
        }),
      } as never,
      wake: async () => undefined,
    },
  );
  if (routed.outcome === 'dropped') throw new Error('Expected a conversation');
  return {conversationId: routed.conversationId, workspaceId, connectionId, conversationKey};
}

describe('reportConversationRunLink', () => {
  it('puts the run link on the surface of an integration conversation', async () => {
    const {conversationId, workspaceId, connectionId, conversationKey} = await routeSlackRequest();
    const integrations = fakeIntegrations();

    await reportConversationRunLink({conversationId, link, integrations: integrations.client});

    expect(integrations.reportInteractionProgress).toHaveBeenCalledWith({
      workspaceId,
      connectionId,
      conversationKey,
      state: 'working',
      links: [link],
    });
  });

  it('does nothing for a web conversation', async () => {
    const {conversation} = await conversationFactory.create();
    const integrations = fakeIntegrations();

    await reportConversationRunLink({
      conversationId: conversation.id,
      link,
      integrations: integrations.client,
    });

    expect(integrations.reportInteractionProgress).not.toHaveBeenCalled();
  });

  it('logs and goes on when the provider fails', async () => {
    const {conversationId} = await routeSlackRequest();
    const integrations = fakeIntegrations();
    integrations.reportInteractionProgress.mockRejectedValue(new Error('Linear is down'));

    await expect(
      reportConversationRunLink({conversationId, link, integrations: integrations.client}),
    ).resolves.toBeUndefined();
  });
});
