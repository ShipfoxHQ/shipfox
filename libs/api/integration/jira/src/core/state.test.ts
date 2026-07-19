import {JiraInstallStateError} from './errors.js';
import {signJiraInstallState, verifyJiraInstallState} from './state.js';

describe('Jira install state', () => {
  it('round-trips signed workspace and user claims', () => {
    const state = signJiraInstallState({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      nonce: 'nonce-1',
      now: new Date('2026-07-07T12:00:00.000Z'),
    });

    const result = verifyJiraInstallState(state, new Date('2026-07-07T12:05:00.000Z'));

    expect(result).toEqual({workspaceId: 'workspace-1', userId: 'user-1'});
  });

  it('rejects a tampered or expired state', () => {
    const state = signJiraInstallState({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      nonce: 'nonce-1',
      now: new Date('2026-07-07T12:00:00.000Z'),
    });
    const [payload, signature] = state.split('.');
    const decoded = JSON.parse(Buffer.from(payload ?? '', 'base64url').toString('utf8'));
    decoded.workspaceId = 'workspace-2';

    const tampered = () =>
      verifyJiraInstallState(
        `${Buffer.from(JSON.stringify(decoded)).toString('base64url')}.${signature}`,
      );
    const expired = () => verifyJiraInstallState(state, new Date('2026-07-07T12:31:00.000Z'));

    expect(tampered).toThrow(JiraInstallStateError);
    expect(expired).toThrow(JiraInstallStateError);
  });
});
