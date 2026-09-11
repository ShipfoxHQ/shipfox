import {agentAccessEnvelopeSchema} from '@shipfox/api-agent-access-dto';
import type {AgentAccessContext} from '@shipfox/api-auth-context';
import type {TriggersInterModuleClient} from '@shipfox/api-triggers-dto/inter-module';
import {triggersInterModuleContract} from '@shipfox/api-triggers-dto/inter-module';
import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import {workflowsInterModuleContract} from '@shipfox/api-workflows-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {createAgentAccessActionTools} from './action-tools.js';

const workspaceId = uuid(1);
const userId = uuid(2);
const runId = uuid(3);
const definitionId = uuid(4);
const projectId = uuid(5);
const context: AgentAccessContext = {
  userId,
  workspaceId,
  credential: {kind: 'oauth_grant', grantId: uuid(6), clientId: 'client'},
};

function clients() {
  const workflows = {
    cancelWorkflowRun: vi.fn(),
    rerunWorkflowRun: vi.fn(),
  } as unknown as WorkflowsModuleClient;
  const triggers = {
    fireManualTrigger: vi.fn(),
    createDevRun: vi.fn(),
  } as unknown as TriggersInterModuleClient;
  return {workflows, triggers, tools: createAgentAccessActionTools({workflows, triggers})};
}

function tool(tools: ReturnType<typeof clients>['tools'], name: string) {
  const candidate = tools.find((entry) => entry.name === name);
  if (!candidate) throw new Error(`Missing action tool ${name}`);
  return candidate;
}

function uuid(number: number): string {
  return `00000000-0000-4000-8000-${number.toString().padStart(12, '0')}`;
}

describe('agent-access action tools', () => {
  test('exports four conservative action tools without composing them', () => {
    const {tools} = clients();

    expect(tools.map((entry) => entry.name)).toEqual([
      'cancel_workflow_run',
      'rerun_workflow_run',
      'fire_manual_trigger',
      'create_dev_run',
    ]);
    expect(tools.map((entry) => entry.annotations)).toEqual([
      {readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false},
      {readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true},
      {readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true},
      {readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true},
    ]);
  });

  test('passes expected attempts and maps retry identity details', async () => {
    const {workflows, tools} = clients();
    vi.mocked(workflows.cancelWorkflowRun).mockRejectedValue(
      createInterModuleKnownError(
        workflowsInterModuleContract.methods.cancelWorkflowRun,
        'attempt-mismatch',
        {currentAttempt: 2},
      ),
    );
    const cancelResponse = await tool(tools, 'cancel_workflow_run').execute({
      context,
      arguments: {run_id: runId, expected_attempt: 1},
    });

    expect(workflows.cancelWorkflowRun).toHaveBeenCalledWith({
      workspaceId,
      workflowRunId: runId,
      expectedAttempt: 1,
    });
    expect(cancelResponse).toEqual({
      ok: false,
      error: {code: 'attempt-mismatch', details: {current_attempt: 2}},
    });

    vi.mocked(workflows.rerunWorkflowRun).mockRejectedValue(
      createInterModuleKnownError(
        workflowsInterModuleContract.methods.rerunWorkflowRun,
        'attempt-mismatch',
        {currentAttempt: 2},
      ),
    );
    const rerunResponse = await tool(tools, 'rerun_workflow_run').execute({
      context,
      arguments: {run_id: runId, expected_attempt: 1, mode: 'failed'},
    });
    expect(rerunResponse).toEqual({
      ok: false,
      error: {code: 'attempt-mismatch', details: {current_attempt: 2}},
    });
  });

  test('deduplicates the same manual request but fingerprints changed inputs', async () => {
    const {triggers, tools} = clients();
    vi.mocked(triggers.fireManualTrigger).mockResolvedValue({
      id: runId,
      name: 'Build',
      deduplicated: false,
    });
    const manual = tool(tools, 'fire_manual_trigger');
    const firstInput = {
      definition_id: definitionId,
      inputs: {z: 'last', a: 'first'},
      idempotency_key: 'retry-key',
    };

    await manual.execute({context, arguments: firstInput});
    await manual.execute({
      context,
      arguments: {
        definition_id: definitionId,
        inputs: {a: 'first', z: 'last'},
        idempotency_key: 'retry-key',
      },
    });
    await manual.execute({
      context,
      arguments: {...firstInput, inputs: {a: 'different', z: 'last'}},
    });

    const keys = vi
      .mocked(triggers.fireManualTrigger)
      .mock.calls.map(([input]) => input.idempotencyKey);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  test('rejects oversized inputs before calling a producer', async () => {
    const {triggers, tools} = clients();
    const response = await tool(tools, 'fire_manual_trigger').execute({
      context,
      arguments: {definition_id: definitionId, inputs: {value: 'x'.repeat(16 * 1024)}},
    });

    expect(response).toEqual({ok: false, error: {code: 'invalid-request'}});
    expect(triggers.fireManualTrigger).not.toHaveBeenCalled();
    expect(agentAccessEnvelopeSchema.safeParse(response).success).toBe(true);
  });

  test('maps admission details and passes dev-run fields to the producer', async () => {
    const {triggers, tools} = clients();
    vi.mocked(triggers.createDevRun).mockRejectedValue(
      createInterModuleKnownError(
        triggersInterModuleContract.methods.createDevRun,
        'admission-denied',
        {
          workspaceId,
          reason: 'suspended',
          requiredAction: {
            reason: 'billing',
            message: 'Update billing',
            url: 'https://example.test',
          },
        },
      ),
    );
    const response = await tool(tools, 'create_dev_run').execute({
      context,
      arguments: {
        project_id: projectId,
        ref: 'main',
        config_path: '.shipfox/workflow.yml',
        trigger: 'manual',
        commit: 'a'.repeat(40),
        replay_event_id: uuid(7),
      },
    });

    expect(triggers.createDevRun).toHaveBeenCalledWith({
      workspaceId,
      projectId,
      ref: 'main',
      configPath: '.shipfox/workflow.yml',
      triggerKey: 'manual',
      commit: 'a'.repeat(40),
      replayEventId: uuid(7),
      userId,
    });
    expect(response).toEqual({
      ok: false,
      error: {
        code: 'admission-denied',
        details: {
          required_action: {
            reason: 'billing',
            message: 'Update billing',
            url: 'https://example.test',
          },
        },
      },
    });
  });
});
