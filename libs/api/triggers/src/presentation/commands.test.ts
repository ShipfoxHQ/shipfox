import {definitionsInterModuleContract} from '@shipfox/api-definitions-dto/inter-module';
import {
  type ProjectsModuleClient,
  projectsInterModuleContract,
} from '@shipfox/api-projects-dto/inter-module';
import {triggersInterModuleContract} from '@shipfox/api-triggers-dto/inter-module';
import {
  type WorkflowsModuleClient,
  workflowsInterModuleContract,
} from '@shipfox/api-workflows-dto/inter-module';
import {createInterModuleKnownError, isInterModuleKnownError} from '@shipfox/inter-module';
import {
  DevRunReplayEventMismatchError,
  ManualTriggerNotFoundError,
  TriggerSubscriptionNotFoundError,
  TriggerSubscriptionNotManualError,
  TriggerWorkspaceMismatchError,
} from '#core/errors.js';

const mocks = vi.hoisted(() => ({
  createDevRun: vi.fn(),
  fireManualTrigger: vi.fn(),
  getTriggerEventById: vi.fn(),
  listDecisionsByReceivedEventId: vi.fn(),
  listDecisionsByReceivedEventIdPage: vi.fn(),
  listReplaysOfTriggerEvent: vi.fn(),
  listReplaysOfTriggerEventPage: vi.fn(),
  listTriggerEventFacets: vi.fn(),
  listTriggerEvents: vi.fn(),
  requireProjectForWorkspace: vi.fn(),
}));

vi.mock('#core/create-dev-run.js', () => ({createDevRun: mocks.createDevRun}));
vi.mock('#core/fire-manual.js', () => ({fireManualTrigger: mocks.fireManualTrigger}));
vi.mock('#db/index.js', () => ({
  getTriggerEventById: mocks.getTriggerEventById,
  listDecisionsByReceivedEventId: mocks.listDecisionsByReceivedEventId,
  listDecisionsByReceivedEventIdPage: mocks.listDecisionsByReceivedEventIdPage,
  listReplaysOfTriggerEvent: mocks.listReplaysOfTriggerEvent,
  listReplaysOfTriggerEventPage: mocks.listReplaysOfTriggerEventPage,
  listTriggerEventFacets: mocks.listTriggerEventFacets,
  listTriggerEvents: mocks.listTriggerEvents,
}));

const {createTriggersInterModulePresentation} = await import('./inter-module.js');

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';
const DEFINITION_ID = '00000000-0000-4000-8000-000000000002';
const PROJECT_ID = '00000000-0000-4000-8000-000000000003';
const USER_ID = '00000000-0000-4000-8000-000000000004';
const SUBSCRIPTION_ID = '00000000-0000-4000-8000-000000000005';
const OTHER_WORKSPACE_ID = '00000000-0000-4000-8000-000000000006';
const context = {signal: new AbortController().signal};

async function rejection(value: Promise<unknown> | unknown): Promise<unknown> {
  return await Promise.resolve(value).catch((error: unknown) => error);
}

function presentation() {
  return createTriggersInterModulePresentation({
    definitions: {} as never,
    projects: {
      requireProjectForWorkspace: mocks.requireProjectForWorkspace,
    } as unknown as ProjectsModuleClient,
    workflows: {} as WorkflowsModuleClient,
  });
}

describe('trigger command presentation', () => {
  beforeEach(() => {
    mocks.createDevRun.mockReset();
    mocks.fireManualTrigger.mockReset();
    mocks.requireProjectForWorkspace.mockReset();
    mocks.requireProjectForWorkspace.mockResolvedValue(undefined);
  });

  test('delegates manual fires and preserves deduplication', async () => {
    mocks.fireManualTrigger.mockResolvedValue({
      id: PROJECT_ID,
      name: 'Manual run',
      deduplicated: true,
    });
    const input = {
      workspaceId: WORKSPACE_ID,
      definitionId: DEFINITION_ID,
      userId: USER_ID,
      inputs: {severity: 'high'},
      idempotencyKey: 'retry-key',
    };

    const result = await presentation().handlers.fireManualTrigger(input, context);

    expect(result).toEqual({id: PROJECT_ID, name: 'Manual run', deduplicated: true});
    expect(mocks.fireManualTrigger).toHaveBeenCalledWith({...input, workflows: {}});
  });

  test('maps a missing manual trigger to the command error', async () => {
    mocks.fireManualTrigger.mockRejectedValue(new ManualTriggerNotFoundError(DEFINITION_ID));

    const error = await rejection(
      presentation().handlers.fireManualTrigger(
        {workspaceId: WORKSPACE_ID, definitionId: DEFINITION_ID, userId: USER_ID},
        context,
      ),
    );

    expect(
      isInterModuleKnownError(triggersInterModuleContract.methods.fireManualTrigger, error),
    ).toBe(true);
    expect(error).toMatchObject({
      code: 'manual-trigger-not-found',
      details: {definitionId: DEFINITION_ID},
    });
  });

  test.each([
    ['deleted subscription', new TriggerSubscriptionNotFoundError(SUBSCRIPTION_ID)],
    [
      'changed subscription source',
      new TriggerSubscriptionNotManualError(SUBSCRIPTION_ID, 'github'),
    ],
    [
      'moved subscription workspace',
      new TriggerWorkspaceMismatchError(SUBSCRIPTION_ID, OTHER_WORKSPACE_ID, WORKSPACE_ID),
    ],
  ] as const)('maps a %s race to the manual-trigger-not-found command error', async (_race, error) => {
    mocks.fireManualTrigger.mockRejectedValue(error);

    const result = await rejection(
      presentation().handlers.fireManualTrigger(
        {workspaceId: WORKSPACE_ID, definitionId: DEFINITION_ID, userId: USER_ID},
        context,
      ),
    );

    expect(
      isInterModuleKnownError(triggersInterModuleContract.methods.fireManualTrigger, result),
    ).toBe(true);
    expect(result).toMatchObject({
      code: 'manual-trigger-not-found',
      details: {definitionId: DEFINITION_ID},
    });
  });

  test('delegates dev runs without adding an idempotency key', async () => {
    mocks.createDevRun.mockResolvedValue({id: PROJECT_ID, commit: 'a'.repeat(40)});
    const input = {
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      ref: 'main',
      configPath: '.shipfox/workflows/main.yml',
      triggerKey: 'on_demand',
      userId: USER_ID,
    };

    const result = await presentation().handlers.createDevRun(input, context);

    expect(result).toEqual({id: PROJECT_ID, commit: 'a'.repeat(40)});
    expect(mocks.requireProjectForWorkspace).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
    });
    expect(mocks.createDevRun).toHaveBeenCalledWith({
      ...input,
      definitions: {},
      workflows: {},
    });
  });

  test('maps a project workspace mismatch to project-not-found', async () => {
    mocks.requireProjectForWorkspace.mockRejectedValue(
      createInterModuleKnownError(
        projectsInterModuleContract.methods.requireProjectForWorkspace,
        'project-workspace-mismatch',
        {projectId: PROJECT_ID, workspaceId: WORKSPACE_ID},
      ),
    );

    const error = await rejection(
      presentation().handlers.createDevRun(
        {
          workspaceId: WORKSPACE_ID,
          projectId: PROJECT_ID,
          ref: 'main',
          configPath: '.shipfox/workflows/main.yml',
          triggerKey: 'on_demand',
          userId: USER_ID,
        },
        context,
      ),
    );

    expect(isInterModuleKnownError(triggersInterModuleContract.methods.createDevRun, error)).toBe(
      true,
    );
    expect(error).toMatchObject({code: 'project-not-found', details: {projectId: PROJECT_ID}});
    expect(mocks.createDevRun).not.toHaveBeenCalled();
  });

  test('maps the closed dev-run domain union', async () => {
    const replayEventId = '00000000-0000-4000-8000-000000000005';
    mocks.createDevRun.mockRejectedValue(new DevRunReplayEventMismatchError(replayEventId));

    const error = await rejection(
      presentation().handlers.createDevRun(
        {
          workspaceId: WORKSPACE_ID,
          projectId: PROJECT_ID,
          ref: 'main',
          configPath: '.shipfox/workflows/main.yml',
          triggerKey: 'on_push',
          replayEventId,
          userId: USER_ID,
        },
        context,
      ),
    );

    expect(isInterModuleKnownError(triggersInterModuleContract.methods.createDevRun, error)).toBe(
      true,
    );
    expect(error).toMatchObject({
      code: 'replay-event-mismatch',
      details: {replayEventId},
    });
  });

  test('forwards definition and workflow known errors under the trigger method', async () => {
    const refError = createInterModuleKnownError(
      definitionsInterModuleContract.methods.resolveDefinitionAtRef,
      'ref-moved',
      {ref: 'main', expectedCommit: 'a'.repeat(40)},
    );
    mocks.createDevRun.mockRejectedValueOnce(refError);

    const definitionResult = await rejection(
      presentation().handlers.createDevRun(
        {
          workspaceId: WORKSPACE_ID,
          projectId: PROJECT_ID,
          ref: 'main',
          configPath: '.shipfox/workflows/main.yml',
          triggerKey: 'on_demand',
          userId: USER_ID,
        },
        context,
      ),
    );

    expect(
      isInterModuleKnownError(triggersInterModuleContract.methods.createDevRun, definitionResult),
    ).toBe(true);
    expect(definitionResult).toMatchObject({code: 'ref-moved'});

    const workflowError = createInterModuleKnownError(
      workflowsInterModuleContract.methods.startDevRun,
      'workspace-suspended',
      {workspaceId: WORKSPACE_ID},
    );
    mocks.createDevRun.mockRejectedValueOnce(workflowError);

    const workflowResult = await rejection(
      presentation().handlers.createDevRun(
        {
          workspaceId: WORKSPACE_ID,
          projectId: PROJECT_ID,
          ref: 'main',
          configPath: '.shipfox/workflows/main.yml',
          triggerKey: 'on_demand',
          userId: USER_ID,
        },
        context,
      ),
    );

    expect(
      isInterModuleKnownError(triggersInterModuleContract.methods.createDevRun, workflowResult),
    ).toBe(true);
    expect(workflowResult).toMatchObject({
      code: 'workspace-suspended',
      details: {workspaceId: WORKSPACE_ID},
    });
  });

  test('forwards producer-valid definition error details without narrowing them', async () => {
    const reason = 'x'.repeat(2048);
    mocks.createDevRun.mockRejectedValue(
      createInterModuleKnownError(
        definitionsInterModuleContract.methods.resolveDefinitionAtRef,
        'invalid-definition',
        {errors: [{message: 'Invalid definition', reason}]},
      ),
    );

    const error = await rejection(
      presentation().handlers.createDevRun(
        {
          workspaceId: WORKSPACE_ID,
          projectId: PROJECT_ID,
          ref: 'main',
          configPath: '.shipfox/workflows/main.yml',
          triggerKey: 'on_demand',
          userId: USER_ID,
        },
        context,
      ),
    );

    expect(isInterModuleKnownError(triggersInterModuleContract.methods.createDevRun, error)).toBe(
      true,
    );
    expect(error).toMatchObject({code: 'invalid-definition', details: {errors: [{reason}]}});
  });

  test('keeps producer error unions in the command contracts', () => {
    expect(
      Object.keys(triggersInterModuleContract.methods.fireManualTrigger.errors).sort(),
    ).toEqual(
      [
        'manual-trigger-not-found',
        ...Object.keys(workflowsInterModuleContract.methods.startRunFromTrigger.errors),
      ].sort(),
    );
    expect(Object.keys(triggersInterModuleContract.methods.createDevRun.errors).sort()).toEqual(
      [
        'trigger-not-found',
        'inputs-not-allowed',
        'replay-event-required',
        'replay-event-not-allowed',
        'replay-event-not-found',
        'replay-event-mismatch',
        'replay-event-unavailable',
        'trigger-filtered',
        ...Object.keys(definitionsInterModuleContract.methods.resolveDefinitionAtRef.errors),
        ...Object.keys(workflowsInterModuleContract.methods.startDevRun.errors),
      ].sort(),
    );
  });

  test.each([
    ['ref', {ref: 'main\n'}],
    ['configPath', {configPath: '.shipfox/workflows/main.yml\u2028'}],
  ])('rejects control characters in %s', (_field, override) => {
    const result = triggersInterModuleContract.methods.createDevRun.input.safeParse({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      ref: 'main',
      configPath: '.shipfox/workflows/main.yml',
      triggerKey: 'on_demand',
      userId: USER_ID,
      ...override,
    });

    expect(result.success).toBe(false);
  });
});
