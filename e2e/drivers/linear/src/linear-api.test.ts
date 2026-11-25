import {startLinearApiMock} from './linear-api.js';

describe('Linear API mock', () => {
  async function arrange() {
    const mock = await startLinearApiMock({
      endpoint: new URL('http://127.0.0.1:0'),
      issues: [
        {
          id: 'issue-1',
          identifier: 'ENG-1',
          teamId: 'team-1',
          teamKey: 'ENG',
          projectId: 'project-1',
          projectName: 'Payments',
          labels: ['bug'],
        },
      ],
    });
    const graphql = (query: string, variables: Record<string, unknown> = {}) =>
      fetch(new URL('/graphql', mock.endpoint), {
        method: 'POST',
        headers: {
          authorization: 'Bearer linear-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({query, variables}),
      }).then((response) => response.json() as Promise<Record<string, unknown>>);
    return {mock, graphql};
  }

  it('stores activities and links on a session and refuses a repeated activity id', async () => {
    const {mock, graphql} = await arrange();

    try {
      const created = await graphql('mutation ShipfoxAgentActivityCreate($input: X) { x }', {
        input: {
          id: 'activity-1',
          agentSessionId: 'session-1',
          content: {type: 'response', body: 'Done.'},
        },
      });
      const repeated = await graphql('mutation ShipfoxAgentActivityCreate($input: X) { x }', {
        input: {
          id: 'activity-1',
          agentSessionId: 'session-1',
          content: {type: 'response', body: 'Done.'},
        },
      });
      const found = await graphql('query ShipfoxAgentActivity($id: String!) { x }', {
        id: 'activity-1',
      });
      const missing = await graphql('query ShipfoxAgentActivity($id: String!) { x }', {
        id: 'activity-2',
      });
      const updated = await graphql('mutation ShipfoxAgentSessionUpdate($id: String!) { x }', {
        id: 'session-1',
        input: {addedExternalUrls: [{label: 'Run', url: 'https://app.example.test/runs/1'}]},
      });

      expect(created).toEqual({data: {agentActivityCreate: {success: true}}});
      expect(repeated).toMatchObject({errors: [{message: expect.stringContaining('activity-1')}]});
      expect(found).toEqual({data: {agentActivity: {id: 'activity-1'}}});
      expect(missing).toMatchObject({errors: [{message: 'Entity not found: AgentActivity'}]});
      expect(updated).toEqual({data: {agentSessionUpdate: {success: true}}});
      expect(mock.sessionActivities('session-1')).toEqual([
        {
          id: 'activity-1',
          agentSessionId: 'session-1',
          content: {type: 'response', body: 'Done.'},
          ephemeral: false,
        },
      ]);
      expect(mock.sessionExternalUrls('session-1')).toEqual([
        {label: 'Run', url: 'https://app.example.test/runs/1'},
      ]);
      expect(mock.writes().map((write) => [write.kind, write.target])).toEqual([
        ['agentActivityCreate', 'session-1'],
        ['agentSessionUpdate', 'session-1'],
      ]);
      expect(mock.calls.map((call) => call.kind)).toEqual([
        'agentActivityCreate',
        'agentActivityCreate',
        'agentActivity',
        'agentActivity',
        'agentSessionUpdate',
      ]);
    } finally {
      await mock.stop();
    }
  });

  it('serves the issue context of a session and the app identity', async () => {
    const {mock, graphql} = await arrange();

    try {
      const issue = await graphql('query ShipfoxAgentSessionIssue($id: String!) { x }', {
        id: 'issue-1',
      });
      const unknown = await graphql('query ShipfoxAgentSessionIssue($id: String!) { x }', {
        id: 'issue-9',
      });
      const identity = await graphql('query ShipfoxLinearIdentity { x }');

      expect(issue).toEqual({
        data: {
          issue: {
            identifier: 'ENG-1',
            team: {id: 'team-1', key: 'ENG'},
            project: {id: 'project-1', name: 'Payments'},
            labels: {nodes: [{name: 'bug'}]},
          },
        },
      });
      expect(unknown).toMatchObject({errors: [{message: 'Entity not found: Issue'}]});
      expect(identity).toMatchObject({data: {viewer: {id: 'linear-app-user'}}});
    } finally {
      await mock.stop();
    }
  });

  it('refuses an unknown operation', async () => {
    const {mock, graphql} = await arrange();

    try {
      const answer = await graphql('query Something { x }');

      expect(answer).toMatchObject({errors: [{message: 'Unknown operation Something'}]});
    } finally {
      await mock.stop();
    }
  });
});
