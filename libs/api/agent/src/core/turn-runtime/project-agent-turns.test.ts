import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import {getConversationById, getTurnById, listContextItems} from '#db/turn-runtime.js';
import {conversationFactory} from '#test/factories/conversation.js';
import {
  createTestDefinitionsClient,
  projectAgentSnapshot,
} from '#test/fixtures/definitions-client.js';
import {createTestProjectsClient} from '#test/fixtures/projects-client.js';
import {createTestWorkspacesClient} from '#test/fixtures/workspaces-client.js';
import {
  aadForConversationItem,
  conversationDataKey,
  openConversationEntry,
} from '../conversation-sealing.js';
import {postWebConversationMessage} from '../conversations.js';
import type {ConversationItem} from '../entities/conversation.js';
import {beginConversationTurn, finishConversationTurn} from './turn-lifecycle.js';

const integrations = {
  listConversationTools: vi.fn().mockResolvedValue({tools: []}),
  listInteractionProviders: vi.fn().mockResolvedValue({providers: []}),
} as unknown as IntegrationsModuleClient;

async function readSystemPrompt(item: ConversationItem, workspaceId: string): Promise<string> {
  const entry = JSON.parse(
    openConversationEntry({
      key: await conversationDataKey(workspaceId),
      aad: aadForConversationItem({
        workspaceId,
        conversationId: item.conversationId,
        itemId: item.id,
      }),
      sealed: item.sealedEntry,
    }),
  );
  return entry.message.content;
}

async function queueMessage(conversationId: string, body: string) {
  const conversation = await getConversationById(conversationId);
  if (!conversation) throw new Error('The conversation was not stored');
  await postWebConversationMessage({
    conversation,
    authorUserId: crypto.randomUUID(),
    clientMessageId: crypto.randomUUID(),
    body,
  });
}

async function arrange(params: {agentKey?: string} = {}) {
  const workspaceId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const {conversation} = await conversationFactory.create({
    workspaceId,
    projectId,
    agentKey: params.agentKey,
  });
  const definitions = createTestDefinitionsClient();
  const workspaces = createTestWorkspacesClient();
  workspaces.state.memberOf.add(workspaceId);
  const deps = {
    integrations,
    projects: createTestProjectsClient({projects: new Map([[projectId, {workspaceId}]])}),
    definitions: definitions.client,
    workspaces: workspaces.client,
  };
  return {conversation, workspaceId, projectId, definitions, deps};
}

describe('agent config in turns', () => {
  it('keeps the built-in agent when the project has no agent file', async () => {
    const {conversation, deps} = await arrange();

    await beginConversationTurn({conversationId: conversation.id, deps});

    const stored = await getConversationById(conversation.id);
    expect(stored).toMatchObject({agentKey: 'shippy', agentContentHash: null});
  });

  it('appends the instructions of shippy.yaml to the pinned prompt and stores its hash', async () => {
    const {conversation, workspaceId, projectId, definitions, deps} = await arrange();
    definitions.agents.set(projectId, [
      projectAgentSnapshot({
        key: 'shippy',
        instructions: 'Always answer in French.',
        contentHash: 'shippy-hash',
      }),
    ]);

    await beginConversationTurn({conversationId: conversation.id, deps});

    const [system] = await listContextItems({conversationId: conversation.id, fromSeq: 1});
    expect(await readSystemPrompt(system as ConversationItem, workspaceId)).toContain(
      'Always answer in French.',
    );
    expect((await getConversationById(conversation.id))?.agentContentHash).toBe('shippy-hash');
  });

  it('keeps the pinned prompt of a running conversation when the file changes', async () => {
    const {conversation, workspaceId, projectId, definitions, deps} = await arrange();
    definitions.agents.set(projectId, [
      projectAgentSnapshot({key: 'shippy', instructions: 'Answer in French.', contentHash: 'v1'}),
    ]);
    await beginConversationTurn({conversationId: conversation.id, deps});
    definitions.agents.set(projectId, [
      projectAgentSnapshot({key: 'shippy', instructions: 'Answer in Dutch.', contentHash: 'v2'}),
    ]);

    await beginConversationTurn({conversationId: conversation.id, deps});

    const [system] = await listContextItems({conversationId: conversation.id, fromSeq: 1});
    const prompt = await readSystemPrompt(system as ConversationItem, workspaceId);
    expect(prompt).toContain('Answer in French.');
    expect(prompt).not.toContain('Answer in Dutch.');
    expect((await getConversationById(conversation.id))?.agentContentHash).toBe('v1');
  });

  it('pins the whole prompt of a custom agent', async () => {
    const {conversation, workspaceId, projectId, definitions, deps} = await arrange({
      agentKey: 'reviewer',
    });
    definitions.agents.set(projectId, [
      projectAgentSnapshot({
        key: 'reviewer',
        instructions: 'You review pull requests.',
        contentHash: 'reviewer-hash',
      }),
    ]);

    await beginConversationTurn({conversationId: conversation.id, deps});

    const [system] = await listContextItems({conversationId: conversation.id, fromSeq: 1});
    const prompt = await readSystemPrompt(system as ConversationItem, workspaceId);
    expect(prompt.startsWith('You review pull requests.')).toBe(true);
    expect(prompt).not.toContain('Shippy');
    expect(await getConversationById(conversation.id)).toMatchObject({
      agentKey: 'reviewer',
      agentContentHash: 'reviewer-hash',
    });
  });

  it('reads the model of the agent file at the start of each turn', async () => {
    const {conversation, projectId, definitions, deps} = await arrange();
    definitions.agents.set(projectId, [
      projectAgentSnapshot({
        key: 'shippy',
        document: {provider: 'anthropic', model: 'claude-haiku-4-5'},
      }),
    ]);
    const first = await beginConversationTurn({conversationId: conversation.id, deps});
    if (!first) throw new Error('No turn began');
    await finishConversationTurn({
      conversationId: conversation.id,
      turnId: first.turnId,
      status: 'succeeded',
    });
    definitions.agents.set(projectId, [
      projectAgentSnapshot({
        key: 'shippy',
        document: {provider: 'anthropic', model: 'claude-opus-4-5'},
      }),
    ]);
    await queueMessage(conversation.id, 'And now?');

    const second = await beginConversationTurn({conversationId: conversation.id, deps});

    expect(await getTurnById(first.turnId)).toMatchObject({model: 'claude-haiku-4-5'});
    expect(await getTurnById(second?.turnId ?? '')).toMatchObject({
      provider: 'anthropic',
      model: 'claude-opus-4-5',
    });
  });

  it('refuses a message queued for a custom agent that was deleted since', async () => {
    const {conversation, projectId, definitions, deps} = await arrange({
      agentKey: 'reviewer',
    });
    definitions.agents.set(projectId, [
      projectAgentSnapshot({key: 'reviewer', instructions: 'You review pull requests.'}),
    ]);
    const first = await beginConversationTurn({conversationId: conversation.id, deps});
    if (!first) throw new Error('No turn began');
    await finishConversationTurn({
      conversationId: conversation.id,
      turnId: first.turnId,
      status: 'succeeded',
    });
    await queueMessage(conversation.id, 'Another one?');
    definitions.agents.delete(projectId);

    const second = await beginConversationTurn({conversationId: conversation.id, deps});

    expect(second).toBeUndefined();
    const items = await listContextItems({conversationId: conversation.id, fromSeq: 1});
    expect(items.at(-1)?.meta).toEqual({custom_type: 'turn_notice'});
  });

  it('settles a conversation whose custom agent was deleted before its first turn', async () => {
    const {conversation, deps} = await arrange({agentKey: 'reviewer'});

    const turn = await beginConversationTurn({conversationId: conversation.id, deps});

    expect(turn).toBeUndefined();
    const items = await listContextItems({conversationId: conversation.id, fromSeq: 1});
    expect(items.map((item) => item.meta)).toEqual([{role: 'user'}, {custom_type: 'turn_notice'}]);
  });
});
