import {createHmac} from 'node:crypto';
import {buildJiraIssueEnvelope, signJiraAuthorization} from './jira-events.js';

const issue = {id: '10001', key: 'ENG-1', summary: 'Fix it', statusName: 'In Progress'};

describe('Jira event builders', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('signs an HS256 token with the OAuth client secret that is valid now', () => {
    vi.stubEnv('JIRA_OAUTH_CLIENT_SECRET', 'secret');

    const authorization = signJiraAuthorization();

    const token = authorization.replace('Bearer ', '');
    const [header, payload, signature] = token.split('.') as [string, string, string];
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({
      alg: 'HS256',
      typ: 'JWT',
    });
    expect(signature).toBe(
      createHmac('sha256', 'secret').update(`${header}.${payload}`).digest('base64url'),
    );
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      iat: number;
      exp: number;
    };
    expect(Math.abs(claims.iat * 1000 - Date.now())).toBeLessThan(5_000);
    expect(claims.exp).toBeGreaterThan(claims.iat);
  });

  it('refuses to sign without an OAuth client secret', () => {
    vi.stubEnv('JIRA_OAUTH_CLIENT_SECRET', '');

    expect(() => signJiraAuthorization()).toThrow('JIRA_OAUTH_CLIENT_SECRET');
  });

  it('builds a created event that matches the connection webhook', () => {
    const envelope = buildJiraIssueEnvelope({
      event: 'jira:issue_created',
      issue,
      webhookId: 42,
      actorAccountId: 'account-1',
    });

    expect(envelope).toMatchObject({
      webhookEvent: 'jira:issue_created',
      issue_event_type_name: 'issue_created',
      issue: {
        id: '10001',
        key: 'ENG-1',
        fields: {summary: 'Fix it', status: {name: 'In Progress'}},
      },
      user: {accountId: 'account-1'},
      matchedWebhookIds: [42],
    });
    expect(envelope).not.toHaveProperty('changelog');
  });

  it('builds an updated event with the status transition', () => {
    const envelope = buildJiraIssueEnvelope({
      event: 'jira:issue_updated',
      issue,
      webhookId: 42,
      actorAccountId: 'account-1',
      previousStatusName: 'To Do',
    });

    expect(envelope).toMatchObject({
      webhookEvent: 'jira:issue_updated',
      issue_event_type_name: 'issue_generic',
      changelog: {items: [{field: 'status', fromString: 'To Do', toString: 'In Progress'}]},
    });
  });

  it('builds a label event with the project, the labels, and the label change', () => {
    const envelope = buildJiraIssueEnvelope({
      event: 'jira:issue_updated',
      issue: {
        ...issue,
        projectKey: 'ENG',
        labels: ['bug', 'shipfox'],
        siteUrl: 'https://site.atlassian.example.test',
      },
      webhookId: 42,
      actorAccountId: 'account-1',
      previousLabels: ['bug'],
    });

    expect(envelope).toMatchObject({
      issue: {
        self: 'https://site.atlassian.example.test/rest/api/3/issue/10001',
        fields: {project: {key: 'ENG'}, labels: ['bug', 'shipfox']},
      },
      changelog: {
        items: [{field: 'labels', fieldId: 'labels', fromString: 'bug', toString: 'bug shipfox'}],
      },
    });
  });
});
