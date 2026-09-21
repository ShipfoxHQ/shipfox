import {workflowRunDtoSchema} from '@shipfox/api-workflows-dto';
import type {WorkflowRun} from '#core/entities/workflow-run.js';
import {toRunDto} from './workflow-run.js';

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
});
