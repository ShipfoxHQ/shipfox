import {assembleCreationContext, assembleWorkflowRunContext} from './assemble-run-context.js';

describe('assembleWorkflowRunContext', () => {
  const run = {
    id: 'run-1',
    name: 'Build',
    definitionId: 'def-1',
    projectId: 'proj-1',
    workspaceId: 'workspace-1',
    createdAt: new Date('2026-06-30T12:00:00.000Z'),
  };

  it('uses integration payload data as event context', () => {
    const context = assembleWorkflowRunContext({
      run,
      triggerPayload: {
        source: 'github',
        event: 'push',
        deliveryId: 'delivery-1',
        data: {ref: 'refs/heads/main'},
      },
      inputs: {deploy: true},
    });

    expect(context).toEqual({
      run: {
        id: 'run-1',
        name: 'Build',
        definition_id: 'def-1',
        project_id: 'proj-1',
        workspace_id: 'workspace-1',
        created_at: run.createdAt,
      },
      trigger: {source: 'github', event: 'push'},
      event: {ref: 'refs/heads/main'},
      inputs: {deploy: true},
    });
  });

  it.each([
    {
      source: 'manual' as const,
      event: 'fire' as const,
      subscriptionId: 'sub-1',
      userId: 'user-1',
    },
    {
      source: 'cron' as const,
      event: 'tick' as const,
      scheduleId: 'schedule-1',
    },
  ])('uses null event for %s triggers', (triggerPayload) => {
    const context = assembleWorkflowRunContext({run, triggerPayload});

    expect(context.event).toBeNull();
    expect(context.inputs).toBeNull();
  });
});

describe('assembleCreationContext', () => {
  const run = {
    id: 'run-1',
    name: 'Build',
    definitionId: 'def-1',
    projectId: 'proj-1',
    workspaceId: 'workspace-1',
    createdAt: new Date('2026-06-30T12:00:00.000Z'),
  };

  it('wraps the run context with the creation site', () => {
    const context = assembleCreationContext({
      run,
      triggerPayload: {
        source: 'github',
        event: 'push',
        deliveryId: 'delivery-1',
        data: {ref: 'refs/heads/main'},
      },
      inputs: {deploy: true},
    });

    expect(context).toEqual({
      site: 'run-creation',
      values: assembleWorkflowRunContext({
        run,
        triggerPayload: {
          source: 'github',
          event: 'push',
          deliveryId: 'delivery-1',
          data: {ref: 'refs/heads/main'},
        },
        inputs: {deploy: true},
      }),
    });
  });
});
