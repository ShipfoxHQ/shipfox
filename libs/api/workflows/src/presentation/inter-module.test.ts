import {workflowsInterModuleContract} from '@shipfox/api-workflows-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {InvalidJobRunnerLabelsError} from '#core/errors.js';
import {
  AgentConfigUnresolvableError,
  AgentIntegrationMaterializationError,
  DefinitionNotFoundError,
  InterpolationUnresolvableError,
  ProjectMismatchError,
} from '#core/index.js';
import {toStartRunKnownError} from './inter-module.js';

const input = {
  workspaceId: '00000000-0000-4000-8000-000000000001',
  projectId: '00000000-0000-4000-8000-000000000002',
  definitionId: '00000000-0000-4000-8000-000000000003',
  triggerPayload: {
    provider: 'manual' as const,
    source: 'manual' as const,
    event: 'fire' as const,
    subscriptionId: '00000000-0000-4000-8000-000000000004',
    userId: '00000000-0000-4000-8000-000000000005',
  },
  idempotencyKey: 'manual-1',
};

describe('Workflows inter-module presentation', () => {
  test.each([
    ['definition-not-found', () => new DefinitionNotFoundError(input.definitionId)],
    ['project-mismatch', () => new ProjectMismatchError(input.projectId, input.definitionId)],
    ['agent-config-unresolvable', () => new AgentConfigUnresolvableError(input.definitionId)],
    [
      'agent-integration-materialization-failed',
      () => new AgentIntegrationMaterializationError('integration unavailable'),
    ],
    [
      'interpolation-unresolvable',
      () =>
        new InterpolationUnresolvableError(input.definitionId, {
          field: 'env',
          source: 'event.ref',
          envKey: 'REF',
        }),
    ],
    ['invalid-job-runner-labels', () => new InvalidJobRunnerLabelsError(['gpu'])],
  ] as const)('maps %s to the published contract error', (code, error) => {
    const result = toStartRunKnownError(error(), input.definitionId);

    expect(
      isInterModuleKnownError(workflowsInterModuleContract.methods.startRunFromTrigger, result) &&
        result.code,
    ).toBe(code);
  });
});
