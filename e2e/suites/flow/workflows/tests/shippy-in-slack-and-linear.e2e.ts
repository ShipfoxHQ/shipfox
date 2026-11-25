import type {ListProjectsResponseDto} from '@shipfox/api-projects-dto';
import type {TriggerDecisionDto, TriggerEventDetailResponseDto} from '@shipfox/api-triggers-dto';
import {createApiClient, pollUntil} from '@shipfox/e2e-core';
import {
  type LinearAgentActivityRecord,
  postLinearAgentSession,
  startLinearApiMock,
} from '@shipfox/e2e-driver-linear';
import {
  postSlackAgentSessionStopped,
  postSlackAppMention,
  postSlackMessage,
  type SlackApiMockCall,
  startSlackApiMock,
} from '@shipfox/e2e-driver-slack';
import {waitForTriggerEventByDeliveryId} from '@shipfox/e2e-observe-workflows';
import {
  getScriptedManagedProviderRequests,
  registerScriptedManagedProvider,
} from '@shipfox/e2e-setup-agent';
import {createLinearConnection, createSlackConnection} from '@shipfox/e2e-setup-integrations';
import {expect, test} from './fixtures.js';

const REPLY_TIMEOUT_MS = 90_000;
const EVENT_TIMEOUT_MS = 60_000;
const SHIPPY_NAME = 'Shippy';
// Every bot scope the app requests. A connection missing one must reconnect, and agents stay
// silent through it until then.
const SLACK_AGENT_SCOPES = [
  'app_mentions:read',
  'im:history',
  'im:read',
  'mpim:history',
  'mpim:read',
  'chat:write',
  'chat:write.customize',
  'assistant:write',
  'channels:history',
  'groups:history',
  'channels:read',
  'groups:read',
  'users:read',
  'reactions:read',
  'reactions:write',
  'canvases:read',
  'canvases:write',
  'commands',
];

// Both tests script the managed provider of the workspace's default project, which routing
// picks when no agent claims a request, so they take turns.
test.describe.configure({mode: 'serial'});

test('the default Shippy answers Slack mentions, thread replies, and the agent view', async ({
  suite,
}) => {
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const teamId = `T${uniqueId}`;
  const channel = `C${uniqueId}`;
  const agentViewChannel = `D${uniqueId}`;
  const person = `Uperson${uniqueId}`;
  const botUserId = `Ubot${uniqueId}`;
  const botToken = `xoxb-shippy-${uniqueId}`;
  const mentionTs = '1721300000.000001';
  const agentViewTs = '1721300000.000101';
  const text = {
    mention: `hello shippy ${uniqueId}`,
    followUp: `thread follow-up ${uniqueId}`,
    agentView: `agent view question ${uniqueId}`,
  };
  const reply = {
    mention: `Thread answer ${uniqueId}`,
    followUp: `Follow-up answer ${uniqueId}`,
    agentView: `Agent view answer ${uniqueId}`,
  };
  const slackApi = await startSlackApiMock({botToken, botUserId});
  const token = suite.sessionToken;
  const workspaceId = suite.workspaceId;
  const events = (deliveryId: string) =>
    waitForTriggerEventByDeliveryId({deliveryId, workspaceId, token, timeoutMs: EVENT_TIMEOUT_MS});

  try {
    const project = await defaultProject({workspaceId, token});
    await createSlackConnection({
      workspaceId,
      teamId,
      teamName: `E2E Shippy Slack ${uniqueId}`,
      appId: `A${uniqueId}`,
      botUserId,
      botToken,
      scopes: SLACK_AGENT_SCOPES,
    });
    // A conversation keeps its scripted entry across turns, so the thread's entry holds both
    // answers, in turn order.
    await registerScriptedManagedProvider({
      projectId: project.id,
      entries: [
        {
          match: {prompt_contains: text.mention},
          replies: [{text: reply.mention}, {text: reply.followUp}],
        },
        {match: {prompt_contains: text.agentView}, replies: [{text: reply.agentView}]},
      ],
    });

    // A mention in a channel starts a conversation with the default Shippy.
    const mentionEventId = await postSlackAppMention({
      teamId,
      channel,
      ts: mentionTs,
      user: person,
      text: `<@${botUserId}> ${text.mention}`,
    });
    const mentionReply = await waitForSlackCall(slackApi, (call) =>
      isThreadPost(call, {channel, threadTs: mentionTs, text: reply.mention}),
    );
    const mentionEvent = await events(mentionEventId);

    expect(mentionReply).toMatchObject({
      authorization: `Bearer ${botToken}`,
      username: SHIPPY_NAME,
    });
    expect(slackApi.calls).toContainEqual({
      kind: 'reactions.add',
      authorization: `Bearer ${botToken}`,
      channel,
      timestamp: mentionTs,
      name: 'eyes',
    });
    expect(agentDecisions(mentionEvent)).toMatchObject([
      {decision: 'default', project_id: project.id, subscription_id: null},
    ]);

    // A reply in the thread continues the conversation, with no mention.
    const followUpEventId = await postSlackMessage({
      teamId,
      channel,
      channelType: 'channel',
      ts: '1721300000.000002',
      threadTs: mentionTs,
      user: person,
      text: text.followUp,
    });
    await waitForSlackCall(slackApi, (call) =>
      isThreadPost(call, {channel, threadTs: mentionTs, text: reply.followUp}),
    );
    const followUpEvent = await events(followUpEventId);

    expect(agentDecisions(followUpEvent)).toMatchObject([
      {decision: 'owner', project_id: project.id},
    ]);

    // The app's own post in the thread is not a message for an agent.
    const botEventId = await postSlackMessage({
      teamId,
      channel,
      channelType: 'channel',
      ts: '1721300000.000003',
      threadTs: mentionTs,
      user: botUserId,
      botId: `B${uniqueId}`,
      subtype: 'bot_message',
      text: `${text.followUp} (echoed by the app)`,
    });
    const botEvent = await events(botEventId);

    expect(agentDecisions(botEvent)).toEqual([]);
    expect(threadPosts(slackApi, {channel, threadTs: mentionTs})).toHaveLength(2);

    // A message in the agent view shows a loading status, gets its answer, and clears the status.
    const agentViewEventId = await postSlackMessage({
      teamId,
      channel: agentViewChannel,
      channelType: 'im',
      ts: agentViewTs,
      user: person,
      text: text.agentView,
      viewingChannelId: channel,
    });
    const agentViewReply = await waitForSlackCall(slackApi, (call) =>
      isThreadPost(call, {channel: agentViewChannel, threadTs: agentViewTs, text: reply.agentView}),
    );
    await waitForSlackCall(slackApi, (call) =>
      isSessionStatus(call, {channel: agentViewChannel, threadTs: agentViewTs, status: 'active'}),
    );
    const agentViewEvent = await events(agentViewEventId);

    expect(agentViewReply).toMatchObject({username: SHIPPY_NAME});
    expect(
      slackApi.calls
        .filter((call) => call.kind === 'agents.sessions.setStatus')
        .map((call) => call.status),
    ).toEqual(['processing', 'active']);
    expect(agentDecisions(agentViewEvent)).toMatchObject([
      {decision: 'default', project_id: project.id},
    ]);

    // The agent view's stop control reaches the session's conversation.
    const stopEventId = await postSlackAgentSessionStopped({
      teamId,
      channel: agentViewChannel,
      threadTs: agentViewTs,
      user: person,
    });
    const stopEvent = await events(stopEventId);

    expect(agentDecisions(stopEvent)).toMatchObject([{decision: 'owner', project_id: project.id}]);
    const requests = await getScriptedManagedProviderRequests({projectId: project.id});
    expect(requests.filter((request) => request.surprise)).toEqual([]);
    expect(requests).toHaveLength(3);
  } finally {
    await slackApi.stop().catch((error: unknown) => {
      process.stderr.write(`shippy-slack-e2e: stopSlackApiMock failed: ${String(error)}\n`);
    });
  }
});

test('the default Shippy answers a Linear agent session and takes its prompts and stop', async ({
  suite,
}) => {
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const organizationId = `linear-org-${uniqueId}`;
  const appUserId = `linear-app-${uniqueId}`;
  const accessToken = `linear-shippy-token-${uniqueId}`;
  const sessionId = `session-${uniqueId}`;
  const creator = {id: `linear-user-${uniqueId}`, name: 'Ada E2E'};
  const issue = {
    id: `issue-${uniqueId}`,
    identifier: `ENG-${uniqueId.slice(0, 4)}`,
    title: `Ask Shippy ${uniqueId}`,
    teamId: `team-${uniqueId}`,
    teamKey: 'ENG',
    stateId: `state-${uniqueId}`,
    labels: [],
  };
  const reply = {created: `Session answer ${uniqueId}`, prompted: `Prompt answer ${uniqueId}`};
  const prompt = `linear follow-up ${uniqueId}`;
  const linearApi = await startLinearApiMock({accessToken});
  const token = suite.sessionToken;
  const workspaceId = suite.workspaceId;
  const events = (deliveryId: string) =>
    waitForTriggerEventByDeliveryId({deliveryId, workspaceId, token, timeoutMs: EVENT_TIMEOUT_MS});

  try {
    const project = await defaultProject({workspaceId, token});
    await createLinearConnection({
      workspaceId,
      organizationId,
      organizationUrlKey: `shippy-${uniqueId}`,
      appUserId,
      displayName: `E2E Shippy Linear ${uniqueId}`,
      accessToken,
    });
    // The session's prompt context names the issue, so its title selects the entry.
    await registerScriptedManagedProvider({
      projectId: project.id,
      entries: [
        {
          match: {prompt_contains: issue.title},
          replies: [{text: reply.created}, {text: reply.prompted}],
        },
      ],
    });
    const session = {organizationId, appUserId, sessionId, issue, creator};

    // A mention in a comment creates a session, which gets a thought at once and then the answer.
    const createdDeliveryId = await postLinearAgentSession({
      ...session,
      action: 'created',
      commentId: `comment-${uniqueId}`,
      project: {id: `linear-project-${uniqueId}`, name: 'Payments'},
    });
    await waitForLinearActivity(
      linearApi.sessionActivities.bind(linearApi),
      sessionId,
      (activity) => isActivity(activity, {type: 'response', body: reply.created}),
    );
    const createdEvent = await events(createdDeliveryId);

    expect(linearApi.sessionActivities(sessionId).map(({content}) => content)).toEqual([
      {type: 'thought', body: 'Looking into this.'},
      {type: 'response', body: reply.created},
    ]);
    expect(linearApi.calls[0]).toMatchObject({authorization: `Bearer ${accessToken}`});
    expect(agentDecisions(createdEvent)).toMatchObject([
      {decision: 'default', project_id: project.id, subscription_id: null},
    ]);

    // A prompt in the session continues the conversation.
    const promptedDeliveryId = await postLinearAgentSession({
      ...session,
      action: 'prompted',
      prompt,
    });
    await waitForLinearActivity(
      linearApi.sessionActivities.bind(linearApi),
      sessionId,
      (activity) => isActivity(activity, {type: 'response', body: reply.prompted}),
    );
    const promptedEvent = await events(promptedDeliveryId);

    expect(agentDecisions(promptedEvent)).toMatchObject([
      {decision: 'owner', project_id: project.id},
    ]);

    // A stop reaches the session's conversation.
    const stopDeliveryId = await postLinearAgentSession({
      ...session,
      action: 'prompted',
      signal: 'stop',
    });
    const stopEvent = await events(stopDeliveryId);

    expect(agentDecisions(stopEvent)).toMatchObject([{decision: 'owner', project_id: project.id}]);
    expect(linearApi.sessionActivities(sessionId)).toHaveLength(3);
    const requests = await getScriptedManagedProviderRequests({projectId: project.id});
    expect(requests.filter((request) => request.surprise)).toEqual([]);
    expect(requests).toHaveLength(2);
  } finally {
    await linearApi.stop().catch((error: unknown) => {
      process.stderr.write(`shippy-linear-e2e: stopLinearApiMock failed: ${String(error)}\n`);
    });
  }
});

/**
 * The project whose Shippy answers requests that no agent claims. Other specs fill the shared
 * workspace with projects, so the list is paged until the default one appears.
 */
async function defaultProject(params: {workspaceId: string; token: string}) {
  const client = createApiClient({token: params.token});
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({workspace_id: params.workspaceId, limit: '100'});
    if (cursor !== null) query.set('cursor', cursor);
    const page: ListProjectsResponseDto = await client.requestJson<ListProjectsResponseDto>(
      'get',
      `/projects?${query.toString()}`,
    );
    const project = page.projects.find((candidate) => candidate.is_default);
    if (project) return project;
    cursor = page.next_cursor;
  } while (cursor !== null);
  throw new Error(`Workspace ${params.workspaceId} has no default project`);
}

function agentDecisions(event: TriggerEventDetailResponseDto): TriggerDecisionDto[] {
  return event.decisions.filter((decision) => decision.subscription_kind === 'agent');
}

type SlackPost = Extract<SlackApiMockCall, {kind: 'chat.postMessage'}>;

function isThreadPost(
  call: SlackApiMockCall,
  expected: {channel: string; threadTs: string; text: string},
): call is SlackPost {
  return (
    call.kind === 'chat.postMessage' &&
    call.channel === expected.channel &&
    call.threadTs === expected.threadTs &&
    call.text === expected.text
  );
}

function isSessionStatus(
  call: SlackApiMockCall,
  expected: {channel: string; threadTs: string; status: string},
): boolean {
  return (
    call.kind === 'agents.sessions.setStatus' &&
    call.channelId === expected.channel &&
    call.threadTs === expected.threadTs &&
    call.status === expected.status
  );
}

function threadPosts(
  slackApi: {calls: SlackApiMockCall[]},
  thread: {channel: string; threadTs: string},
): SlackPost[] {
  return slackApi.calls.filter(
    (call): call is SlackPost =>
      call.kind === 'chat.postMessage' &&
      call.channel === thread.channel &&
      call.threadTs === thread.threadTs,
  );
}

function isActivity(
  activity: LinearAgentActivityRecord,
  expected: {type: string; body: string},
): boolean {
  return activity.content.type === expected.type && activity.content.body === expected.body;
}

async function waitForSlackCall<T extends SlackApiMockCall>(
  slackApi: {calls: SlackApiMockCall[]},
  match: (call: SlackApiMockCall) => call is T,
): Promise<T>;
async function waitForSlackCall(
  slackApi: {calls: SlackApiMockCall[]},
  match: (call: SlackApiMockCall) => boolean,
): Promise<SlackApiMockCall>;
async function waitForSlackCall(
  slackApi: {calls: SlackApiMockCall[]},
  match: (call: SlackApiMockCall) => boolean,
): Promise<SlackApiMockCall> {
  return await pollUntil(
    {
      timeoutMs: REPLY_TIMEOUT_MS,
      describe: () =>
        `a Slack call; observed ${slackApi.calls.map((call) => call.kind).join(', ') || 'none'}`,
    },
    () => Promise.resolve(slackApi.calls.find(match) ?? null),
  );
}

async function waitForLinearActivity(
  sessionActivities: (sessionId: string) => LinearAgentActivityRecord[],
  sessionId: string,
  match: (activity: LinearAgentActivityRecord) => boolean,
): Promise<LinearAgentActivityRecord> {
  return await pollUntil(
    {
      timeoutMs: REPLY_TIMEOUT_MS,
      describe: () =>
        `a Linear activity; observed ${JSON.stringify(
          sessionActivities(sessionId).map((activity) => activity.content),
        )}`,
    },
    () => Promise.resolve(sessionActivities(sessionId).find(match) ?? null),
  );
}
