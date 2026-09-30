import {createHmac} from 'node:crypto';
import {
  buildAgentSessionEnvelope,
  buildIssueUpdateEnvelope,
  signLinearHeaders,
} from './linear-events.js';

const issue = {
  id: 'issue-1',
  identifier: 'ENG-1',
  title: 'Fix it',
  teamId: 'team-1',
  stateId: 'state-2',
};

describe('Linear event builders', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('signs the raw body with the webhook secret', () => {
    vi.stubEnv('LINEAR_WEBHOOK_SIGNING_SECRET', 'secret');

    const headers = signLinearHeaders({rawBody: '{"a":1}', deliveryId: 'd-1', event: 'Issue'});

    expect(headers).toEqual({
      'linear-delivery': 'd-1',
      'linear-event': 'Issue',
      'linear-signature': createHmac('sha256', 'secret').update('{"a":1}').digest('hex'),
    });
  });

  it('refuses to sign without a webhook secret', () => {
    vi.stubEnv('LINEAR_WEBHOOK_SIGNING_SECRET', '');

    expect(() => signLinearHeaders({rawBody: '{}', deliveryId: 'd-1', event: 'Issue'})).toThrow(
      'LINEAR_WEBHOOK_SIGNING_SECRET',
    );
  });

  it('builds an issue update with the previous state', () => {
    const envelope = buildIssueUpdateEnvelope({
      organizationId: 'org-1',
      issue,
      previousStateId: 'state-1',
      actorId: 'user-1',
    });

    expect(envelope).toMatchObject({
      action: 'update',
      type: 'Issue',
      organizationId: 'org-1',
      data: {id: 'issue-1', stateId: 'state-2'},
      updatedFrom: {stateId: 'state-1'},
    });
    expect(Math.abs(envelope.webhookTimestamp - Date.now())).toBeLessThan(5_000);
  });

  it('carries the prompt only on prompted agent sessions', () => {
    const base = {organizationId: 'org-1', appUserId: 'app-1', sessionId: 'session-1', issue};

    const created = buildAgentSessionEnvelope({...base, action: 'created', prompt: 'hi'});
    const prompted = buildAgentSessionEnvelope({...base, action: 'prompted', prompt: 'hi'});

    expect(created).not.toHaveProperty('agentActivity');
    expect(prompted).toMatchObject({
      action: 'prompted',
      type: 'AgentSessionEvent',
      appUserId: 'app-1',
      agentSession: {id: 'session-1', issueId: 'issue-1'},
      agentActivity: {content: {type: 'prompt', body: 'hi'}},
    });
  });
});
