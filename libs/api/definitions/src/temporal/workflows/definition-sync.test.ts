const workflowMocks = vi.hoisted(() => ({
  prepareDefinitionSync: vi.fn(),
  discoverDefinitionWorkflows: vi.fn(),
  discoverDefinitionFiles: vi.fn(),
  syncDefinitionAgents: vi.fn(),
  fetchAndApplyDefinitionWorkflows: vi.fn(),
  fetchAndApplyDefinitionWorkflowsV2: vi.fn(),
  markDefinitionSyncSucceeded: vi.fn(),
  markDefinitionSyncSucceededV2: vi.fn(),
  markDefinitionSyncFailed: vi.fn(),
  markDefinitionSyncFailedV2: vi.fn(),
  log: {warn: vi.fn()},
  patched: vi.fn((_patchId: string) => true),
}));

vi.mock('@temporalio/workflow', async () => {
  const actual =
    await vi.importActual<typeof import('@temporalio/workflow')>('@temporalio/workflow');
  return {
    ...actual,
    log: workflowMocks.log,
    patched: workflowMocks.patched,
    proxyActivities: vi.fn(() => ({
      prepareDefinitionSync: workflowMocks.prepareDefinitionSync,
      discoverDefinitionWorkflows: workflowMocks.discoverDefinitionWorkflows,
      discoverDefinitionFiles: workflowMocks.discoverDefinitionFiles,
      syncDefinitionAgents: workflowMocks.syncDefinitionAgents,
      fetchAndApplyDefinitionWorkflows: workflowMocks.fetchAndApplyDefinitionWorkflows,
      fetchAndApplyDefinitionWorkflowsV2: workflowMocks.fetchAndApplyDefinitionWorkflowsV2,
      markDefinitionSyncSucceeded: workflowMocks.markDefinitionSyncSucceeded,
      markDefinitionSyncSucceededV2: workflowMocks.markDefinitionSyncSucceededV2,
      markDefinitionSyncFailed: workflowMocks.markDefinitionSyncFailed,
      markDefinitionSyncFailedV2: workflowMocks.markDefinitionSyncFailedV2,
    })),
  };
});

import {ActivityFailure, ApplicationFailure, RetryState} from '@temporalio/common';
import {classifyWorkflowError, definitionSyncWorkflow} from './definition-sync.js';

describe('definitionSyncWorkflow error classification', () => {
  it('unwraps activity application failures before persisting sync failure metadata', () => {
    const cause = ApplicationFailure.nonRetryable(
      'Invalid workflow definition at .shipfox/workflows/bad.yml',
      'invalid-definition',
    );
    const error = new ActivityFailure(
      'Activity failed',
      'fetchAndApplyDefinitionWorkflows',
      'activity-id',
      RetryState.NON_RETRYABLE_FAILURE,
      'worker',
      cause,
    );

    const result = classifyWorkflowError(error);

    expect(result).toEqual({
      code: 'invalid-definition',
      message: 'Invalid workflow definition at .shipfox/workflows/bad.yml',
    });
  });

  it('classifies a bare ApplicationFailure using its type', () => {
    const error = ApplicationFailure.retryable('GitHub request timed out', 'provider-timeout');

    const result = classifyWorkflowError(error);

    expect(result).toEqual({
      code: 'provider-timeout',
      message: 'GitHub request timed out',
    });
  });

  it('carries structured diagnostics from an ApplicationFailure', () => {
    const diagnostics = [
      {
        code: 'invalid-definition',
        message: 'Step gate success must be a valid CEL boolean expression: No such key',
        path: 'jobs.build.steps.0.gate.success',
        severity: 'error' as const,
      },
    ];
    const error = ApplicationFailure.nonRetryable(
      'Invalid workflow definition',
      'invalid-definition',
      diagnostics,
    );

    const result = classifyWorkflowError(error);

    expect(result).toEqual({
      code: 'invalid-definition',
      message: 'Invalid workflow definition',
      diagnostics,
    });
  });

  it('falls back to unknown when ApplicationFailure.type is not a known sync error code', () => {
    const error = ApplicationFailure.nonRetryable('boom', 'something-unexpected');

    const result = classifyWorkflowError(error);

    expect(result).toEqual({
      code: 'unknown',
      message: 'boom',
    });
  });

  it('classifies non-temporal errors as unknown and preserves the message', () => {
    const error = new Error('connection reset');

    const result = classifyWorkflowError(error);

    expect(result).toEqual({
      code: 'unknown',
      message: 'connection reset',
    });
  });
});

describe('definitionSyncWorkflow failure handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workflowMocks.patched.mockReturnValue(true);
    workflowMocks.prepareDefinitionSync.mockResolvedValue({sourceRef: 'main'});
    workflowMocks.discoverDefinitionWorkflows.mockResolvedValue({
      paths: ['.shipfox/workflows/invalid.yml'],
    });
    workflowMocks.discoverDefinitionFiles.mockResolvedValue({
      workflowPaths: ['.shipfox/workflows/invalid.yml'],
      agentPaths: [],
      nestedAgentPaths: [],
      agentFilesTruncated: false,
    });
    workflowMocks.syncDefinitionAgents.mockResolvedValue({
      appliedCount: 0,
      deletedCount: 0,
      diagnostics: [],
    });
    workflowMocks.markDefinitionSyncFailed.mockResolvedValue(undefined);
  });

  it('passes activity diagnostics to the failed-sync activity', async () => {
    const diagnostics = [
      {
        code: 'invalid-definition',
        message: 'Invalid expression: No such key',
        path: 'jobs.build.success',
        filePath: '.shipfox/workflows/invalid.yml',
        severity: 'error' as const,
      },
    ];
    const activityError = new ActivityFailure(
      'Activity failed',
      'fetchAndApplyDefinitionWorkflowsV2',
      'activity-id',
      RetryState.NON_RETRYABLE_FAILURE,
      'worker',
      ApplicationFailure.nonRetryable(
        'Invalid workflow definition',
        'invalid-definition',
        diagnostics,
      ),
    );
    workflowMocks.fetchAndApplyDefinitionWorkflowsV2.mockRejectedValueOnce(activityError);

    const input = {
      projectId: 'project-id',
      workspaceId: 'workspace-id',
      sourceConnectionId: 'connection-id',
      sourceExternalRepositoryId: 'repository-id',
    };

    await expect(definitionSyncWorkflow(input)).rejects.toBe(activityError);
    expect(workflowMocks.markDefinitionSyncFailedV2).toHaveBeenCalledWith({
      ...input,
      sourceRef: 'main',
      code: 'invalid-definition',
      message: 'Invalid workflow definition',
      diagnostics,
    });
  });

  it('keeps existing workflow histories on the legacy activity input shape', async () => {
    const diagnostics = [
      {
        code: 'invalid-definition',
        message: 'Invalid expression: No such key',
        path: 'jobs.build.success',
        severity: 'error' as const,
      },
    ];
    const activityError = new ActivityFailure(
      'Activity failed',
      'fetchAndApplyDefinitionWorkflows',
      'activity-id',
      RetryState.NON_RETRYABLE_FAILURE,
      'worker',
      ApplicationFailure.nonRetryable(
        'Invalid workflow definition',
        'invalid-definition',
        diagnostics,
      ),
    );
    workflowMocks.patched.mockReturnValue(false);
    workflowMocks.fetchAndApplyDefinitionWorkflows.mockRejectedValueOnce(activityError);

    const input = {
      projectId: 'project-id',
      workspaceId: 'workspace-id',
      sourceConnectionId: 'connection-id',
      sourceExternalRepositoryId: 'repository-id',
    };

    await expect(definitionSyncWorkflow(input)).rejects.toBe(activityError);
    expect(workflowMocks.markDefinitionSyncFailed).toHaveBeenCalledWith({
      ...input,
      sourceRef: 'main',
      code: 'invalid-definition',
      message: 'Invalid workflow definition',
    });
    expect(workflowMocks.log.warn).toHaveBeenCalledWith(
      'Definition sync diagnostics were not persisted for an existing workflow run',
      {code: 'invalid-definition'},
    );
  });
});

describe('definitionSyncWorkflow agent files', () => {
  const input = {
    projectId: 'project-id',
    workspaceId: 'workspace-id',
    sourceConnectionId: 'connection-id',
    sourceExternalRepositoryId: 'repository-id',
  };
  const agentError = {
    code: 'invalid-agent',
    message:
      'Invalid agent file .shipfox/agents/reviewer.yml: A custom agent requires "description".',
    filePath: '.shipfox/agents/reviewer.yml',
    severity: 'error' as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    workflowMocks.patched.mockReturnValue(true);
    workflowMocks.prepareDefinitionSync.mockResolvedValue({sourceRef: 'main'});
    workflowMocks.discoverDefinitionFiles.mockResolvedValue({
      workflowPaths: ['.shipfox/workflows/ci.yml'],
      agentPaths: ['.shipfox/agents/reviewer.yml'],
      nestedAgentPaths: ['.shipfox/agents/team/triage.yml'],
      agentFilesTruncated: false,
    });
    workflowMocks.syncDefinitionAgents.mockResolvedValue({
      appliedCount: 0,
      deletedCount: 0,
      diagnostics: [agentError],
    });
    workflowMocks.fetchAndApplyDefinitionWorkflowsV2.mockResolvedValue({
      appliedCount: 1,
      deletedCount: 0,
      diagnostics: [],
    });
    workflowMocks.markDefinitionSyncSucceededV2.mockResolvedValue(undefined);
    workflowMocks.markDefinitionSyncFailedV2.mockResolvedValue(undefined);
  });

  it('syncs the agent files and reports their diagnostics with the workflow ones', async () => {
    const result = await definitionSyncWorkflow(input);

    expect(result).toEqual({sourceRef: 'main', appliedCount: 1, deletedCount: 0});
    expect(workflowMocks.syncDefinitionAgents).toHaveBeenCalledWith({
      ...input,
      sourceRef: 'main',
      sourceCommitSha: undefined,
      paths: ['.shipfox/agents/reviewer.yml'],
      nestedPaths: ['.shipfox/agents/team/triage.yml'],
      truncated: false,
    });
    expect(workflowMocks.fetchAndApplyDefinitionWorkflowsV2).toHaveBeenCalledWith(
      expect.objectContaining({paths: ['.shipfox/workflows/ci.yml']}),
    );
    expect(workflowMocks.markDefinitionSyncSucceededV2).toHaveBeenCalledWith(
      expect.objectContaining({diagnostics: [agentError]}),
    );
  });

  it('syncs workflows when only agent files exist', async () => {
    workflowMocks.discoverDefinitionFiles.mockResolvedValue({
      workflowPaths: [],
      agentPaths: ['.shipfox/agents/shippy.yml'],
      nestedAgentPaths: [],
      agentFilesTruncated: false,
    });

    await definitionSyncWorkflow(input);

    expect(workflowMocks.fetchAndApplyDefinitionWorkflowsV2).toHaveBeenCalledWith(
      expect.objectContaining({paths: []}),
    );
  });

  it('does not let a failed agent sync block the workflows', async () => {
    workflowMocks.syncDefinitionAgents.mockRejectedValueOnce(
      new ActivityFailure(
        'Activity failed',
        'syncDefinitionAgents',
        'activity-id',
        RetryState.MAXIMUM_ATTEMPTS_REACHED,
        'worker',
        ApplicationFailure.retryable('GitHub request timed out', 'provider-timeout'),
      ),
    );

    await expect(definitionSyncWorkflow(input)).resolves.toEqual({
      sourceRef: 'main',
      appliedCount: 1,
      deletedCount: 0,
    });
    expect(workflowMocks.markDefinitionSyncSucceededV2).toHaveBeenCalledWith(
      expect.objectContaining({
        diagnostics: [
          {
            code: 'provider-timeout',
            message: 'Agent files were not synced: GitHub request timed out',
            severity: 'error',
          },
        ],
      }),
    );
    expect(workflowMocks.markDefinitionSyncFailedV2).not.toHaveBeenCalled();
  });

  it('keeps the agent diagnostics when the workflows fail', async () => {
    const activityError = new ActivityFailure(
      'Activity failed',
      'fetchAndApplyDefinitionWorkflowsV2',
      'activity-id',
      RetryState.NON_RETRYABLE_FAILURE,
      'worker',
      ApplicationFailure.nonRetryable('Invalid workflow definition', 'invalid-definition'),
    );
    workflowMocks.fetchAndApplyDefinitionWorkflowsV2.mockRejectedValueOnce(activityError);

    await expect(definitionSyncWorkflow(input)).rejects.toBe(activityError);
    expect(workflowMocks.markDefinitionSyncFailedV2).toHaveBeenCalledWith({
      ...input,
      sourceRef: 'main',
      code: 'invalid-definition',
      message: 'Invalid workflow definition',
      diagnostics: [agentError],
    });
  });

  it('reads only the workflow folder for histories that began before agent files', async () => {
    workflowMocks.patched.mockImplementation((id: string) => id !== 'definition-sync-agents');
    workflowMocks.discoverDefinitionWorkflows.mockResolvedValue({
      paths: ['.shipfox/workflows/ci.yml'],
    });

    await definitionSyncWorkflow(input);

    expect(workflowMocks.discoverDefinitionFiles).not.toHaveBeenCalled();
    expect(workflowMocks.syncDefinitionAgents).not.toHaveBeenCalled();
    expect(workflowMocks.discoverDefinitionWorkflows).toHaveBeenCalledOnce();
  });
});
