import {workflowRunDtoSchema, workflowRunSelectionResponseSchema} from '@shipfox/api-workflows-dto';
import type {WorkflowRun} from '#core/entities/workflow-run.js';
import {toRunDto, toRunSelectionDto} from './workflow-run.js';

describe('workflow run DTOs', () => {
  it('exposes secret input references on run details with DTO field names', () => {
    const run: WorkflowRun = {
      id: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      definitionId: crypto.randomUUID(),
      number: 1,
      name: 'Deploy',
      workflowName: 'Deploy',
      nameOverride: null,
      status: 'succeeded',
      origin: 'synced',
      devSource: null,
      currentAttempt: 1,
      triggerProvider: 'manual',
      triggerSource: 'manual',
      triggerEvent: 'fire',
      triggerPayload: {source: 'manual', event: 'fire'},
      triggerReference: null,
      inputs: null,
      secretInputs: {
        DEPLOY_TOKEN: {store: 'local', key: 'PROD_DEPLOY_TOKEN', projectId: null},
        DATABASE_URL: {
          store: 'local',
          key: 'DATABASE_URL',
          projectId: crypto.randomUUID(),
        },
      },
      sourceSnapshot: null,
      triggerIdempotencyKey: null,
      timeoutMs: 60_000,
      version: 1,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      startedAt: null,
      finishedAt: new Date('2026-01-01T00:01:00.000Z'),
    };

    const detail = toRunDto(run);

    expect(workflowRunDtoSchema.parse(detail)).toEqual(detail);
    expect(detail.secret_inputs).toEqual({
      DEPLOY_TOKEN: {store: 'local', key: 'PROD_DEPLOY_TOKEN', project_id: null},
      DATABASE_URL: expect.objectContaining({
        store: 'local',
        key: 'DATABASE_URL',
        project_id: expect.any(String),
      }),
    });
  });

  it('names the composite action file that holds a selected inner step', () => {
    const file = {
      kind: 'action' as const,
      uses: './.shipfox/actions/setup',
      digest: `sha256:${'c'.repeat(64)}`,
      path: 'action.yml',
    };

    const dto = toRunSelectionDto({
      workflowRunId: crypto.randomUUID(),
      workflowRunAttempt: 1,
      jobId: crypto.randomUUID(),
      jobExecutionId: crypto.randomUUID(),
      stepId: crypto.randomUUID(),
      stepAttemptId: crypto.randomUUID(),
      stepAttempt: 1,
      sourceLocation: {startLine: 5, endLine: 6, file},
    });

    expect(workflowRunSelectionResponseSchema.parse(dto).source_location).toEqual({
      start_line: 5,
      end_line: 6,
      file,
    });
  });
});
