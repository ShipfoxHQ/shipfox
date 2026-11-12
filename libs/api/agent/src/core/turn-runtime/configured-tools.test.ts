import {fauxAssistantMessage, fauxToolCall} from '@earendil-works/pi-ai';
import {integrationsInterModuleContract} from '@shipfox/api-integration-core-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {eq} from 'drizzle-orm';
import {db} from '#db/index.js';
import {toolCallStarts} from '#db/schema/tool-call-starts.js';
import {listContextItems} from '#db/turn-runtime.js';
import {conversationFactory} from '#test/factories/conversation.js';
import {
  createTestDefinitionsClient,
  projectAgentSnapshot,
} from '#test/fixtures/definitions-client.js';
import {createTestProjectsClient} from '#test/fixtures/projects-client.js';
import {createScriptedModel} from '#test/fixtures/scripted-model.js';
import {createTestWorkspacesClient} from '#test/fixtures/workspaces-client.js';
import {
  aadForConversationItem,
  conversationDataKey,
  openConversationEntry,
} from '../conversation-sealing.js';
import type {ConversationItem} from '../entities/conversation.js';
import {runModelCall} from './model-call.js';
import {
  runToolCall,
  UNFINISHED_WRITE_OUTCOME_TEXT,
  UNKNOWN_WRITE_OUTCOME_TEXT,
} from './tool-call.js';
import {beginConversationTurn} from './turn-lifecycle.js';

const connectionId = crypto.randomUUID();

const grant = {
  connectionId,
  connectionSlug: 'github-main',
  provider: 'github',
  requiredScope: [],
  tools: [
    {
      id: 'issue_read',
      description: 'Read issues.',
      sensitivity: 'read' as const,
      sensitive: false,
      requiredScope: [],
      inputSchema: {type: 'object', properties: {number: {type: 'number'}}},
      result: 'json' as const,
    },
    {
      id: 'issue_comment',
      description: 'Comment on an issue.',
      sensitivity: 'write' as const,
      sensitive: true,
      requiredScope: [],
      inputSchema: {type: 'object', properties: {body: {type: 'string'}}},
      result: 'json' as const,
    },
    {
      id: 'issue_label',
      description: 'Read or change labels.',
      sensitivity: 'write' as const,
      sensitive: true,
      requiredScope: [],
      inputSchema: {type: 'object', properties: {method: {type: 'string'}}},
      result: 'json' as const,
      methods: [
        {
          id: 'list',
          token: 'issue_label.list',
          description: 'List labels.',
          sensitivity: 'read' as const,
          sensitive: false,
          requiredScope: [],
        },
        {
          id: 'add',
          token: 'issue_label.add',
          description: 'Add a label.',
          sensitivity: 'write' as const,
          sensitive: true,
          requiredScope: [],
        },
      ],
    },
    {
      id: 'download_file',
      description: 'Download a file.',
      sensitivity: 'read' as const,
      sensitive: false,
      requiredScope: [],
      inputSchema: {type: 'object'},
      result: 'file' as const,
    },
  ],
};

async function setup(options: {refuseGrant?: boolean; connectionSlug?: string} = {}) {
  const workspaceId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const {conversation} = await conversationFactory.create({workspaceId, projectId});
  const callTool = vi.fn().mockResolvedValue({
    outcome: 'success',
    result: null,
    content: [{type: 'text', text: 'done'}],
  });
  const resolveAgentTools = vi.fn(() =>
    options.refuseGrant
      ? Promise.reject(
          createInterModuleKnownError(
            integrationsInterModuleContract.methods.resolveAgentTools,
            'selection-invalid',
            {
              integrationIndex: 0,
              reason: 'tool-unknown',
              message: 'Unknown integration tool: issue_comment',
              connection: 'github-main',
              tool: 'issue_comment',
            },
          ),
        )
      : Promise.resolve({
          integrations: [
            {...grant, connectionSlug: options.connectionSlug ?? grant.connectionSlug},
          ],
        }),
  );
  const integrations = {
    callTool,
    resolveAgentTools,
    listConversationTools: vi.fn().mockResolvedValue({tools: []}),
    listInteractionProviders: vi.fn().mockResolvedValue({providers: []}),
  } as never;
  const definitions = createTestDefinitionsClient();
  definitions.agents.set(projectId, [
    projectAgentSnapshot({
      key: 'shippy',
      document: {
        integrations: [{connection: 'github-main', include: ['issue_*']}],
      },
    }),
  ]);
  const workspaces = createTestWorkspacesClient();
  workspaces.state.memberOf.add(workspaceId);
  const deps = {
    integrations,
    projects: createTestProjectsClient({projects: new Map([[projectId, {workspaceId}]])}),
    definitions: definitions.client,
    workspaces: workspaces.client,
  };
  const turn = await beginConversationTurn({conversationId: conversation.id, deps});
  if (!turn) throw new Error('No turn began');
  const items = async () => await listContextItems({conversationId: conversation.id, fromSeq: 1});

  const callTools = async (name: string, args: Record<string, string | number>) => {
    const model = createScriptedModel([
      fauxAssistantMessage([fauxToolCall(name, args, {id: 'call-1'})], {stopReason: 'toolUse'}),
    ]);
    await runModelCall({
      conversationId: conversation.id,
      turnId: turn.turnId,
      modelCallIndex: 0,
      createModelRuntime: model.createModelRuntime,
    });
  };
  const run = (overrides: {lastAttempt?: boolean} = {}) =>
    runToolCall({
      conversationId: conversation.id,
      turnId: turn.turnId,
      modelCallIndex: 0,
      callIndex: 0,
      integrations,
      definitions: definitions.client,
      lastAttempt: overrides.lastAttempt ?? false,
    });
  const readEntry = async (item: ConversationItem) =>
    JSON.parse(
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
  const starts = async () =>
    await db().select().from(toolCallStarts).where(eq(toolCallStarts.turnId, turn.turnId));
  return {
    conversation,
    workspaceId,
    projectId,
    callTool,
    resolveAgentTools,
    items,
    callTools,
    run,
    readEntry,
    starts,
  };
}

describe('tools granted by an agent file', () => {
  it('offers them next to the built-in tools, named by connection', async () => {
    const {items, readEntry, resolveAgentTools, projectId, workspaceId} = await setup();

    const [system] = await items();
    const entry = await readEntry(system as ConversationItem);

    expect(entry.message.toolsAdded.map((tool: {name: string}) => tool.name)).toEqual([
      'github_main__issue_comment',
      'github_main__issue_label',
      'github_main__issue_read',
      'read_skill',
    ]);
    expect(resolveAgentTools).toHaveBeenCalledWith({
      workspaceId,
      projectId,
      integrations: [{connection: 'github-main', include: ['issue_*']}],
    });
    const label = entry.message.toolsAdded.find(
      (tool: {name: string}) => tool.name === 'github_main__issue_label',
    );
    expect(label.description).toContain('Set `method` to one of: list, add.');
  });

  it('keeps tools of a long connection slug apart', async () => {
    const longSlug = 'a'.repeat(80);
    const {items, readEntry} = await setup({connectionSlug: longSlug});

    const [system] = await items();
    const entry = await readEntry(system as ConversationItem);

    const names: string[] = entry.message.toolsAdded.map((tool: {name: string}) => tool.name);
    const granted = names.filter((name) => name.startsWith('a'));
    expect(granted).toHaveLength(3);
    expect(new Set(granted).size).toBe(3);
    expect(granted.every((name) => name.length <= 64)).toBe(true);
  });

  it('leaves out a tool whose result a conversation cannot read', async () => {
    const {items, readEntry} = await setup();

    const [system] = await items();
    const entry = await readEntry(system as ConversationItem);

    expect(JSON.stringify(entry.message.toolsAdded)).not.toContain('download_file');
  });

  it('uses a read tool of the connection and records no start', async () => {
    const {callTools, run, callTool, starts, conversation, projectId} = await setup();
    await callTools('github_main__issue_read', {number: 7});

    await run();

    expect(callTool).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId,
        arguments: {number: 7},
        tool: expect.objectContaining({id: 'issue_read', provider: 'github'}),
        caller: expect.objectContaining({
          kind: 'conversation',
          projectId,
          conversationId: conversation.id,
          grantedByAgent: true,
        }),
      }),
    );
    expect(await starts()).toEqual([]);
  });

  it('offers only the built-in tools when the grant no longer resolves', async () => {
    const {
      items,
      readEntry,
      callTools,
      run,
      callTool,
      items: list,
    } = await setup({
      refuseGrant: true,
    });

    const [system] = await items();
    const entry = await readEntry(system as ConversationItem);
    expect(entry.message.toolsAdded.map((tool: {name: string}) => tool.name)).toEqual([
      'read_skill',
    ]);
    await callTools('github_main__issue_comment', {body: 'hi'});
    await run();

    expect(callTool).not.toHaveBeenCalled();
    const result = await readEntry((await list()).at(-1) as ConversationItem);
    expect(result.message.isError).toBe(true);
    expect(result.message.content[0].text).toContain('Unknown tool "github_main__issue_comment"');
  });

  it('never repeats a write after a crash, and tells the model the outcome is unknown', async () => {
    const {callTools, run, callTool, starts, items, readEntry} = await setup();
    await callTools('github_main__issue_comment', {body: 'Looks good'});
    callTool.mockRejectedValueOnce(new Error('connection reset'));

    await expect(run()).rejects.toThrow('connection reset');
    const repeat = await run();

    expect(repeat).toEqual({status: 'success'});
    expect(callTool).toHaveBeenCalledOnce();
    expect(await starts()).toHaveLength(1);
    const stored = (await items()).at(-1) as ConversationItem;
    expect(stored.meta).toMatchObject({role: 'toolResult', outcome: 'unknown'});
    const entry = await readEntry(stored);
    expect(entry.message.details).toEqual({outcome: 'unknown'});
    expect(entry.message.isError).toBe(false);
    expect(entry.message.content[0].text).toContain(UNKNOWN_WRITE_OUTCOME_TEXT);
  });

  it('stores a write that timed out as unknown, and a read that timed out as an error', async () => {
    const timeout = {outcome: 'error', code: 'provider-timeout', message: 'Provider timed out'};
    const writes = await setup();
    await writes.callTools('github_main__issue_comment', {body: 'Looks good'});
    writes.callTool.mockResolvedValueOnce(timeout);

    await writes.run();

    const stored = (await writes.items()).at(-1) as ConversationItem;
    expect(stored.meta).toMatchObject({role: 'toolResult', outcome: 'unknown'});
    const entry = await writes.readEntry(stored);
    expect(entry.message.isError).toBe(false);
    expect(entry.message.content[0].text).toContain(UNFINISHED_WRITE_OUTCOME_TEXT);

    const reads = await setup();
    await reads.callTools('github_main__issue_read', {number: 7});
    reads.callTool.mockResolvedValueOnce(timeout);

    await reads.run();

    const readStored = (await reads.items()).at(-1) as ConversationItem;
    expect(readStored.meta).toMatchObject({role: 'toolResult', is_error: true});
    expect(readStored.meta).not.toHaveProperty('outcome');
  });

  it('stores a write that failed unclassified after it may have reached the provider as unknown', async () => {
    const {callTools, run, callTool, items, readEntry} = await setup();
    await callTools('github_main__issue_comment', {body: 'Looks good'});
    callTool.mockResolvedValueOnce({
      outcome: 'error',
      code: 'unknown',
      message: 'Integration tool call failed',
      mayHaveReachedProvider: true,
    });

    await run();

    const stored = (await items()).at(-1) as ConversationItem;
    expect(stored.meta).toMatchObject({role: 'toolResult', outcome: 'unknown'});
    const entry = await readEntry(stored);
    expect(entry.message.isError).toBe(false);
    expect(entry.message.content[0].text).toContain(UNFINISHED_WRITE_OUTCOME_TEXT);
  });

  it('keeps an unclassified write failure an error when the provider cannot have received it', async () => {
    const {callTools, run, callTool, items} = await setup();
    await callTools('github_main__issue_comment', {body: 'Looks good'});
    callTool.mockResolvedValueOnce({
      outcome: 'error',
      code: 'unknown',
      message: 'Integration tool call failed',
    });

    await run();

    const stored = (await items()).at(-1) as ConversationItem;
    expect(stored.meta).toMatchObject({role: 'toolResult', is_error: true});
    expect(stored.meta).not.toHaveProperty('outcome');
  });

  it('keeps any other failed write result an error', async () => {
    const {callTools, run, callTool, items} = await setup();
    await callTools('github_main__issue_comment', {body: 'Looks good'});
    callTool.mockResolvedValueOnce({outcome: 'error', code: 'not-found', message: 'No issue'});

    await run();

    const stored = (await items()).at(-1) as ConversationItem;
    expect(stored.meta).toMatchObject({role: 'toolResult', is_error: true});
    expect(stored.meta).not.toHaveProperty('outcome');
  });

  it('stores a write that fails on the last attempt as unknown', async () => {
    const {callTools, run, callTool, starts, items, readEntry} = await setup();
    await callTools('github_main__issue_comment', {body: 'Looks good'});
    callTool.mockRejectedValueOnce(new Error('connection reset'));

    const result = await run({lastAttempt: true});

    expect(result).toEqual({status: 'success'});
    expect(callTool).toHaveBeenCalledOnce();
    expect(await starts()).toHaveLength(1);
    const stored = (await items()).at(-1) as ConversationItem;
    expect(stored.meta).toMatchObject({role: 'toolResult', outcome: 'unknown'});
    const entry = await readEntry(stored);
    expect(entry.message.content[0].text).toContain(UNFINISHED_WRITE_OUTCOME_TEXT);
  });

  it('keeps a read that fails on the last attempt an error', async () => {
    const {callTools, run, callTool, items, readEntry} = await setup();
    await callTools('github_main__issue_read', {number: 7});
    callTool.mockRejectedValueOnce(new Error('connection reset'));

    const result = await run({lastAttempt: true});

    expect(result).toEqual({status: 'error'});
    const stored = (await items()).at(-1) as ConversationItem;
    expect(stored.meta).not.toHaveProperty('outcome');
    const entry = await readEntry(stored);
    expect(entry.message.content[0].text).toContain('The tool failed to run');
  });

  it('runs a write once when nothing goes wrong', async () => {
    const {callTools, run, callTool, starts} = await setup();
    await callTools('github_main__issue_comment', {body: 'Looks good'});

    await run();
    await run();

    expect(callTool).toHaveBeenCalledOnce();
    expect(await starts()).toHaveLength(1);
  });

  it('treats a read method of a write family as a read, and its write method as a write', async () => {
    const reads = await setup();
    await reads.callTools('github_main__issue_label', {method: 'list'});
    reads.callTool.mockRejectedValueOnce(new Error('connection reset'));

    await expect(reads.run()).rejects.toThrow('connection reset');
    await reads.run();

    expect(reads.callTool).toHaveBeenCalledTimes(2);
    expect(await reads.starts()).toEqual([]);

    const writes = await setup();
    await writes.callTools('github_main__issue_label', {method: 'add'});
    writes.callTool.mockRejectedValueOnce(new Error('connection reset'));

    await expect(writes.run()).rejects.toThrow('connection reset');
    await writes.run();

    expect(writes.callTool).toHaveBeenCalledOnce();
    expect(await writes.starts()).toHaveLength(1);
  });
});
