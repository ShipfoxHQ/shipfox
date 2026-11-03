import {randomUUID} from 'node:crypto';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import type {LinearIssueContext} from '#api/client.js';
import {LinearIntegrationProviderError} from '#core/errors.js';
import {LinearInteractionProvider} from './interaction-provider.js';

function connection(): IntegrationConnection<'linear'> {
  return {
    id: randomUUID(),
    workspaceId: randomUUID(),
    provider: 'linear',
    externalAccountId: 'org-1',
    slug: 'linear_acme',
    displayName: 'Linear Acme',
    lifecycleStatus: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    repositoryAccessMode: 'selected',
  };
}

const fetchedIssue: LinearIssueContext = {
  identifier: 'ENG-12',
  teamId: 'team-1',
  teamKey: 'ENG',
  projectId: 'project-1',
  projectName: 'Payments',
  labels: ['payments'],
};

function setup() {
  const getIssueContext = vi.fn(() => Promise.resolve(fetchedIssue));
  const getAccessToken = vi.fn(() => Promise.resolve('linear-token'));
  const createAgentActivity = vi.fn((_input: unknown) => Promise.resolve());
  const setAgentSessionExternalUrls = vi.fn((_input: unknown) => Promise.resolve());
  const provider = new LinearInteractionProvider({
    linear: {getIssueContext, createAgentActivity, setAgentSessionExternalUrls},
    tokenStore: {getAccessToken},
  });
  return {
    provider,
    getIssueContext,
    getAccessToken,
    createAgentActivity,
    setAgentSessionExternalUrls,
  };
}

const completeIssue = {
  id: 'issue-1',
  identifier: 'ENG-12',
  team: {id: 'team-1', key: 'ENG'},
  project: {id: 'project-1', name: 'Payments'},
  labels: [{name: 'payments'}, {name: 'bug'}],
};

function created(overrides: Record<string, unknown> = {}) {
  return {
    type: 'AgentSessionEvent',
    action: 'created',
    promptContext: '<issue identifier="ENG-12">Fix the refund total</issue>',
    agentSession: {
      id: 'session-1',
      creator: {id: 'user-1', name: 'Ada'},
      issue: completeIssue,
      ...overrides,
    },
  };
}

describe('LinearInteractionProvider', () => {
  it('declares agent session events as a request and a follow-up', () => {
    const {provider} = setup();

    expect(provider.interactionEvents).toEqual({
      'agentSession.created': 'request',
      'agentSession.prompted': 'follow_up',
    });
  });

  describe('a created session', () => {
    it('reads a mention as a request keyed by the session, with the issue context', async () => {
      const {provider, getIssueContext} = setup();

      const interaction = await provider.readInteraction({
        connection: connection(),
        event: 'agentSession.created',
        payload: created({comment: {id: 'comment-1', body: '@shipfox fix it'}}),
      });

      expect(interaction).toEqual({
        conversationKey: 'session-1',
        role: 'request',
        context: {
          trigger: 'mention',
          team_id: 'team-1',
          team_key: 'ENG',
          labels: ['payments', 'bug'],
          project_id: 'project-1',
          project_name: 'Payments',
          issue_identifier: 'ENG-12',
        },
        author: {externalId: 'user-1', displayName: 'Ada'},
        text: '<issue identifier="ENG-12">Fix the refund total</issue>',
      });
      expect(getIssueContext).not.toHaveBeenCalled();
    });

    it('reads an assignment as a delegation', async () => {
      const {provider} = setup();

      const interaction = await provider.readInteraction({
        connection: connection(),
        event: 'agentSession.created',
        payload: created({comment: null}),
      });

      expect(interaction?.context).toMatchObject({trigger: 'delegation'});
    });

    it.each([
      {
        omitted: 'team',
        issue: {id: 'issue-1', identifier: 'ENG-12', labels: [], project: null},
      },
      {
        omitted: 'labels',
        issue: {
          id: 'issue-1',
          identifier: 'ENG-12',
          team: {id: 'team-1', key: 'ENG'},
          project: null,
        },
      },
      {
        omitted: 'project',
        issue: {
          id: 'issue-1',
          identifier: 'ENG-12',
          team: {id: 'team-1', key: 'ENG'},
          labels: [],
        },
      },
    ])('reads the issue from the API when the payload omits the $omitted', async ({issue}) => {
      const {provider, getIssueContext, getAccessToken} = setup();
      const conn = connection();

      const interaction = await provider.readInteraction({
        connection: conn,
        event: 'agentSession.created',
        payload: created({issue}),
      });

      expect(getAccessToken).toHaveBeenCalledWith({connectionId: conn.id});
      expect(getIssueContext).toHaveBeenCalledWith({
        accessToken: 'linear-token',
        issueId: 'issue-1',
      });
      expect(interaction?.context).toEqual({
        trigger: 'delegation',
        team_id: 'team-1',
        team_key: 'ENG',
        labels: ['payments'],
        project_id: 'project-1',
        project_name: 'Payments',
        issue_identifier: 'ENG-12',
      });
    });

    it('treats an explicit null project as no project without calling the API', async () => {
      const {provider, getIssueContext} = setup();

      const interaction = await provider.readInteraction({
        connection: connection(),
        event: 'agentSession.created',
        payload: created({issue: {...completeIssue, project: null, labels: []}}),
      });

      expect(interaction?.context).toMatchObject({
        project_id: null,
        project_name: null,
        labels: [],
      });
      expect(getIssueContext).not.toHaveBeenCalled();
    });

    it('returns an empty context for a session that is not on an issue', async () => {
      const {provider, getIssueContext} = setup();

      const interaction = await provider.readInteraction({
        connection: connection(),
        event: 'agentSession.created',
        payload: created({issue: null}),
      });

      expect(interaction?.context).toEqual({
        trigger: 'delegation',
        team_id: null,
        team_key: null,
        labels: [],
        project_id: null,
        project_name: null,
        issue_identifier: null,
      });
      expect(getIssueContext).not.toHaveBeenCalled();
    });

    it('fails when the API cannot be read, so the event is retried rather than misrouted', async () => {
      const {provider, getIssueContext} = setup();
      getIssueContext.mockRejectedValueOnce(new Error('Linear is down'));

      const result = provider.readInteraction({
        connection: connection(),
        event: 'agentSession.created',
        payload: created({issue: {id: 'issue-1'}}),
      });

      await expect(result).rejects.toThrow('Linear is down');
    });
  });

  describe('a prompted session', () => {
    function prompted(agentActivity: Record<string, unknown>) {
      return {
        type: 'AgentSessionEvent',
        action: 'prompted',
        agentSession: {id: 'session-1', creator: {id: 'user-1', name: 'Ada'}, issue: completeIssue},
        agentActivity,
      };
    }

    it('reads a prompt as a follow-up with the activity body', async () => {
      const {provider, getIssueContext} = setup();

      const interaction = await provider.readInteraction({
        connection: connection(),
        event: 'agentSession.prompted',
        payload: prompted({body: 'Also add a test', user: {id: 'user-2', name: 'Grace'}}),
      });

      expect(interaction).toEqual({
        conversationKey: 'session-1',
        role: 'follow_up',
        context: {},
        author: {externalId: 'user-2', displayName: 'Grace'},
        text: 'Also add a test',
      });
      expect(getIssueContext).not.toHaveBeenCalled();
    });

    it('reads the body from the activity content when it is not on the activity', async () => {
      const {provider} = setup();

      const interaction = await provider.readInteraction({
        connection: connection(),
        event: 'agentSession.prompted',
        payload: prompted({content: {type: 'prompt', body: 'Also add a test'}}),
      });

      expect(interaction).toMatchObject({role: 'follow_up', text: 'Also add a test'});
    });

    it('reads a prompt with the stop signal as a stop', async () => {
      const {provider} = setup();

      const interaction = await provider.readInteraction({
        connection: connection(),
        event: 'agentSession.prompted',
        payload: prompted({signal: 'stop', body: ''}),
      });

      expect(interaction).toMatchObject({conversationKey: 'session-1', role: 'stop', text: ''});
    });

    it('ignores a prompt with no text', async () => {
      const {provider} = setup();

      const interaction = await provider.readInteraction({
        connection: connection(),
        event: 'agentSession.prompted',
        payload: prompted({body: '  '}),
      });

      expect(interaction).toBeUndefined();
    });
  });

  it('ignores a payload that is not an agent session event', async () => {
    const {provider} = setup();

    const interaction = await provider.readInteraction({
      connection: connection(),
      event: 'agentSession.created',
      payload: {type: 'Issue', action: 'create', data: {id: 'issue-1'}},
    });

    expect(interaction).toBeUndefined();
  });

  it('writes reply guidance for the surface', () => {
    const {provider} = setup();

    expect(provider.replyGuidance).toContain('Linear');
    expect(provider.replyGuidance).not.toContain('—');
  });

  describe('sendReply', () => {
    function reply(kind: 'response' | 'error', text: string) {
      return {
        connection: connection(),
        conversationKey: 'session-1',
        replyId: 'reply-1',
        kind,
        text,
        agent: {name: 'Shippy'},
      };
    }

    it('posts the answer as a response activity on the session', async () => {
      const {provider, createAgentActivity} = setup();

      const outcome = await provider.sendReply(reply('response', 'Refunds are fixed in ENG-12.'));

      expect(outcome).toEqual({outcome: 'delivered'});
      expect(createAgentActivity).toHaveBeenCalledWith({
        accessToken: 'linear-token',
        agentSessionId: 'session-1',
        content: {type: 'response', body: 'Refunds are fixed in ENG-12.'},
      });
    });

    it('posts a failure as an error activity', async () => {
      const {provider, createAgentActivity} = setup();

      const outcome = await provider.sendReply(reply('error', 'The answer took too long.'));

      expect(outcome).toEqual({outcome: 'delivered'});
      expect(createAgentActivity).toHaveBeenCalledWith({
        accessToken: 'linear-token',
        agentSessionId: 'session-1',
        content: {type: 'error', body: 'The answer took too long.'},
      });
    });

    it('is undeliverable when Linear rejects the activity', async () => {
      const {provider, createAgentActivity} = setup();
      createAgentActivity.mockRejectedValue(
        new LinearIntegrationProviderError('malformed-provider-response', 'Linear rejected it'),
      );

      const outcome = await provider.sendReply(reply('response', 'Done.'));

      expect(outcome).toEqual({outcome: 'undeliverable', reason: 'Linear rejected it'});
    });

    it('is undeliverable when the app lost access to the session', async () => {
      const {provider, createAgentActivity} = setup();
      createAgentActivity.mockRejectedValue(
        new LinearIntegrationProviderError('access-denied', 'Linear request was rejected'),
      );

      const outcome = await provider.sendReply(reply('response', 'Done.'));

      expect(outcome.outcome).toBe('undeliverable');
    });

    it.each([
      'rate-limited',
      'timeout',
      'provider-unavailable',
    ] as const)('fails on %s so the delivery is retried', async (reason) => {
      const {provider, createAgentActivity} = setup();
      createAgentActivity.mockRejectedValue(
        new LinearIntegrationProviderError(reason, 'Try again'),
      );

      const result = provider.sendReply(reply('response', 'Done.'));

      await expect(result).rejects.toMatchObject({reason});
    });
  });

  describe('reportProgress', () => {
    function progress(overrides: Record<string, unknown> = {}) {
      return {
        connection: connection(),
        conversationKey: 'session-1',
        state: 'working' as const,
        ...overrides,
      };
    }

    it('posts a tool call as an ephemeral action activity', async () => {
      const {provider, createAgentActivity, setAgentSessionExternalUrls} = setup();

      await provider.reportProgress(progress({detail: 'get_issue'}));

      expect(createAgentActivity).toHaveBeenCalledWith({
        accessToken: 'linear-token',
        agentSessionId: 'session-1',
        content: {type: 'action', action: 'get_issue', parameter: ''},
        ephemeral: true,
      });
      expect(setAgentSessionExternalUrls).not.toHaveBeenCalled();
    });

    it('puts links on the session as external URLs', async () => {
      const {provider, createAgentActivity, setAgentSessionExternalUrls} = setup();
      const links = [{label: 'Run', url: 'https://app.shipfox.io/runs/1'}];

      await provider.reportProgress(progress({links}));

      expect(setAgentSessionExternalUrls).toHaveBeenCalledWith({
        accessToken: 'linear-token',
        agentSessionId: 'session-1',
        urls: links,
      });
      expect(createAgentActivity).not.toHaveBeenCalled();
    });

    it('posts nothing when the turn goes idle, because the reply clears the action', async () => {
      const {provider, createAgentActivity, setAgentSessionExternalUrls, getAccessToken} = setup();

      await provider.reportProgress(progress({state: 'idle'}));

      expect(createAgentActivity).not.toHaveBeenCalled();
      expect(setAgentSessionExternalUrls).not.toHaveBeenCalled();
      expect(getAccessToken).not.toHaveBeenCalled();
    });
  });
});
