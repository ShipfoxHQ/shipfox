import type {AgentAccessContext} from '@shipfox/api-auth-context';
import {createAgentAccessToolCallRecorder} from './audit.js';

const baseContext: AgentAccessContext = {
  userId: 'user-1',
  workspaceId: 'workspace-1',
  credential: {kind: 'oauth_grant', grantId: 'grant-1', clientId: 'client-1'},
};

describe('agent-access tool call audit recorder', () => {
  test('records bounded OAuth identity fields without tool arguments', () => {
    const recordMetric = vi.fn();
    const logInfo = vi.fn();
    const recorder = createAgentAccessToolCallRecorder({recordMetric, logInfo});

    recorder({
      tool: 'agent_access_fixture',
      outcome: 'success',
      errorCode: 'none',
      context: baseContext,
    });

    expect(recordMetric).toHaveBeenCalledWith({
      tool: 'agent_access_fixture',
      outcome: 'success',
    });
    expect(logInfo).toHaveBeenCalledWith(
      {
        tool: 'agent_access_fixture',
        outcome: 'success',
        errorCode: 'none',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        credentialKind: 'oauth_grant',
        credentialId: 'grant-1',
        clientId: 'client-1',
      },
      'agent access tool call audited',
    );
    expect(logInfo.mock.calls[0]?.[0]).not.toHaveProperty('arguments');
  });

  test('records action attribution without recording action inputs', () => {
    const logInfo = vi.fn();
    const recorder = createAgentAccessToolCallRecorder({logInfo, recordMetric: vi.fn()});

    recorder({
      tool: 'cancel_workflow_run',
      outcome: 'success',
      errorCode: 'none',
      context: baseContext,
      action: {
        kind: 'cancel_workflow_run',
        target: {target_run_id: 'run-1'},
        expected_attempt: 2,
        inputs_supplied: false,
        idempotency_key: false,
        result_run_id: 'run-1',
        result_attempt: 2,
        authority_outcome: 'ok',
      },
    });

    expect(logInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        action: expect.objectContaining({
          kind: 'cancel_workflow_run',
          target: {target_run_id: 'run-1'},
          authority_outcome: 'ok',
        }),
      }),
      'agent access tool call audited',
    );
    expect(logInfo.mock.calls[0]?.[0].action).not.toHaveProperty('inputs');
  });

  test('keeps the OAuth grant identity explicit', () => {
    const logInfo = vi.fn();
    const recorder = createAgentAccessToolCallRecorder({logInfo, recordMetric: vi.fn()});

    recorder({
      tool: 'agent_access_fixture',
      outcome: 'tool-error',
      errorCode: 'invalid-request',
      context: baseContext,
    });

    expect(logInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialKind: 'oauth_grant',
        credentialId: 'grant-1',
        clientId: 'client-1',
      }),
      'agent access tool call audited',
    );
  });
});
