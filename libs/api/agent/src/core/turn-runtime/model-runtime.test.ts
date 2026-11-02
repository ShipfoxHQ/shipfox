import type {ManagedModelProvider} from '@shipfox/api-agent-dto';
import {getConversationById} from '#db/turn-runtime.js';
import {conversationFactory} from '#test/factories/conversation.js';
import {turnFactory} from '#test/factories/turn.js';
import {TurnFailure} from './failures.js';
import {createServerModelRuntime} from './model-runtime.js';

function managedProvider(overrides: Partial<ManagedModelProvider> = {}) {
  const resolveCredentials = vi.fn<ManagedModelProvider['resolveCredentials']>().mockResolvedValue({
    api: 'openai-responses',
    baseUrl: 'https://gateway.example.test/inference/',
    credentials: {api_key: 'managed-token'},
  });
  const provider: ManagedModelProvider = {
    id: 'shipfox',
    label: 'Shipfox',
    models: [
      {id: 'responses-model', label: 'Responses model', api: 'openai-responses', reasoning: true},
    ],
    defaultModel: 'responses-model',
    resolveCredentials,
    ...overrides,
  };
  return {provider, resolveCredentials};
}

async function setup() {
  const workspaceId = crypto.randomUUID();
  const {conversation: created} = await conversationFactory.create({workspaceId});
  const conversation = (await getConversationById(created.id)) as NonNullable<
    Awaited<ReturnType<typeof getConversationById>>
  >;
  const turn = await turnFactory.create({
    conversationId: conversation.id,
    provider: 'shipfox',
    model: 'responses-model',
  });
  return {conversation, turn};
}

describe('createServerModelRuntime', () => {
  it('asks for credentials as the conversation, with its agent key', async () => {
    const {conversation, turn} = await setup();
    const {provider, resolveCredentials} = managedProvider();

    await createServerModelRuntime({secrets: undefined as never, managedProvider: provider})({
      conversation,
      turn,
      renewal: false,
    });

    expect(resolveCredentials).toHaveBeenCalledWith({
      workspaceId: conversation.workspaceId,
      subject: {
        kind: 'conversation',
        projectId: conversation.projectId,
        conversationId: conversation.id,
        agentKey: 'shippy',
      },
      model: 'responses-model',
    });
  });

  it('sends the request to the gateway with the managed token and the conversation as cache key', async () => {
    const {conversation, turn} = await setup();
    const {provider} = managedProvider();
    const runtime = await createServerModelRuntime({
      secrets: undefined as never,
      managedProvider: provider,
    })({conversation, turn, renewal: false});
    const fetched = vi.fn().mockResolvedValue(new Response('{}', {status: 500}));

    const stream = runtime.stream(
      {messages: [{role: 'user', content: 'hi', timestamp: Date.now()}]},
      {sessionId: conversation.id, fetch: fetched},
    );
    await stream.result();

    const [url, init] = fetched.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://gateway.example.test/inference/v1/responses');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer managed-token');
    expect(JSON.parse(init.body as string).prompt_cache_key).toBe(conversation.id);
  });

  it('refuses a locked model at the start of a turn, and serves it once the turn has begun', async () => {
    const {conversation, turn} = await setup();
    const {provider} = managedProvider({
      availability: () =>
        Promise.resolve(
          new Map([
            ['responses-model', {notice: {code: 'locked', message: 'Model is locked'}}],
          ]) as never,
        ),
    });
    const create = createServerModelRuntime({
      secrets: undefined as never,
      managedProvider: provider,
    });

    const start = create({conversation, turn, renewal: false});
    const later = create({conversation, turn, renewal: true});

    await expect(start).rejects.toMatchObject({code: 'model_unavailable', retryable: false});
    await expect(start).rejects.toBeInstanceOf(TurnFailure);
    await expect(later).resolves.toMatchObject({
      model: expect.objectContaining({id: 'responses-model'}),
    });
  });

  it('fails a turn that has no model', async () => {
    const {conversation, turn} = await setup();

    const runtime = createServerModelRuntime({secrets: undefined as never})({
      conversation,
      turn: {...turn, model: null},
      renewal: false,
    });

    await expect(runtime).rejects.toMatchObject({code: 'model_unavailable'});
  });
});
