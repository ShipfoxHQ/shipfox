import {
  type AgentAccessEnvelopeDto,
  agentAccessEnvelopeSchema,
  type CheckWorkflowResultDto,
  checkWorkflowResultSchema,
} from '@shipfox/api-agent-access-dto';
import type {AgentAccessContext} from '@shipfox/api-auth-context';
import {
  type TriggersInterModuleClient,
  triggersInterModuleContract,
} from '@shipfox/api-triggers-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {createCheckWorkflowTool} from './check-workflow-tool.js';

const workspaceId = uuid(1);
const projectId = uuid(2);
const eventId = uuid(3);
const context: AgentAccessContext = {
  userId: uuid(4),
  workspaceId,
  credential: {kind: 'oauth_grant', grantId: uuid(5), clientId: 'client'},
};
const COMMIT = 'a'.repeat(40);

type CheckWorkflowOutput = Awaited<ReturnType<TriggersInterModuleClient['checkWorkflow']>>;

function setup() {
  const checkWorkflow = vi.fn<(input: unknown) => Promise<CheckWorkflowOutput>>();
  const tool = createCheckWorkflowTool({checkWorkflow} as unknown as TriggersInterModuleClient);
  return {checkWorkflow, tool};
}

function output(overrides: Partial<CheckWorkflowOutput> = {}): CheckWorkflowOutput {
  return {
    ref: 'main',
    commit: COMMIT,
    valid: true,
    errors: [],
    errorCount: 0,
    warnings: [],
    triggers: {
      on_pr: {
        source: 'github',
        event: 'pull_request.opened',
        filter: 'event.pull_request.draft == false',
        with: {mode: 'review'},
        secrets: {TOKEN: 'GITHUB_TOKEN'},
      },
    },
    ...overrides,
  };
}

function success(response: AgentAccessEnvelopeDto): CheckWorkflowResultDto {
  expect(response.ok).toBe(true);
  if (!response.ok) throw new Error('Expected a successful response');
  expect(agentAccessEnvelopeSchema.safeParse(response).success).toBe(true);
  expect(checkWorkflowResultSchema.safeParse(response.result).success).toBe(true);
  return response.result as CheckWorkflowResultDto;
}

describe('check_workflow', () => {
  test('is a read tool, so the admin endpoint can serve it', () => {
    const {tool} = setup();

    expect(tool.annotations).toMatchObject({readOnlyHint: true, destructiveHint: false});
  });

  test('checks local content in the credential workspace and lists the triggers', async () => {
    const {checkWorkflow, tool} = setup();
    checkWorkflow.mockResolvedValue(output());

    const result = success(
      await tool.execute({
        context,
        arguments: {
          project_id: projectId,
          config_path: '.shipfox/workflows/review.yml',
          content: 'name: Review\n',
        },
      }),
    );

    expect(checkWorkflow).toHaveBeenCalledWith({
      workspaceId,
      projectId,
      configPath: '.shipfox/workflows/review.yml',
      content: 'name: Review\n',
    });
    expect(result).toEqual({
      valid: true,
      ref: 'main',
      commit: COMMIT,
      errors: [],
      errors_total: 0,
      errors_truncated: false,
      warnings: [],
      warnings_truncated: false,
      triggers: [
        {
          key: 'on_pr',
          source: 'github',
          event: 'pull_request.opened',
          filter: 'event.pull_request.draft == false',
        },
      ],
    });
  });

  test('returns an invalid definition as a result with the total error count', async () => {
    const {checkWorkflow, tool} = setup();
    checkWorkflow.mockResolvedValue(
      output({
        valid: false,
        errors: [{message: 'jobs is required', path: 'jobs', reason: 'missing'}],
        errorCount: 140,
        triggers: {},
      }),
    );

    const result = success(
      await tool.execute({
        context,
        arguments: {project_id: projectId, config_path: 'ci.yml', ref: 'main'},
      }),
    );

    expect(result).toMatchObject({
      valid: false,
      errors: [{message: 'jobs is required', path: 'jobs', reason: 'missing'}],
      errors_total: 140,
      errors_truncated: true,
      triggers: [],
    });
  });

  test('reports each event result, its counts, and a diagnostic without payload sizes', async () => {
    const {checkWorkflow, tool} = setup();
    checkWorkflow.mockResolvedValue(
      output({
        events: [
          {
            eventId,
            result: 'filter-error',
            source: 'github',
            event: 'pull_request.opened',
            receivedAt: '2026-10-13T09:12:44.000Z',
            reason: 'Trigger filter evaluation failed',
            diagnostic: {version: 1, code: 'expression-index-out-of-bounds', index: 3, size: 1},
          },
          {eventId: uuid(6), result: 'not-found'},
        ],
        eventCounts: {
          matched: 0,
          filtered: 0,
          'filter-error': 1,
          'event-mismatch': 0,
          'payload-unavailable': 0,
          'not-found': 1,
        },
      }),
    );

    const result = success(
      await tool.execute({
        context,
        arguments: {
          project_id: projectId,
          config_path: 'ci.yml',
          ref: 'main',
          trigger: 'on_pr',
          event_ids: [eventId, uuid(6)],
        },
      }),
    );

    expect(checkWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({triggerKey: 'on_pr', eventIds: [eventId, uuid(6)]}),
    );
    expect(result.events).toEqual([
      {
        event_id: eventId,
        result: 'filter-error',
        source: 'github',
        event: 'pull_request.opened',
        received_at: '2026-10-13T09:12:44.000Z',
        reason: 'Trigger filter evaluation failed',
        diagnostic: {code: 'expression-index-out-of-bounds', index: 3},
      },
      {event_id: uuid(6), result: 'not-found'},
    ]);
    expect(result.event_counts).toEqual({
      matched: 0,
      filtered: 0,
      filter_error: 1,
      event_mismatch: 0,
      payload_unavailable: 0,
      not_found: 1,
    });
  });

  test('keeps the errors within the response budget and marks the cut', async () => {
    const {checkWorkflow, tool} = setup();
    const errors = Array.from({length: 100}, (_, index) => ({
      message: `${index}: ${'x'.repeat(2000)}`,
      path: 'p'.repeat(600),
      reason: 'r'.repeat(600),
    }));
    checkWorkflow.mockResolvedValue(output({valid: false, errors, errorCount: 100, triggers: {}}));

    const result = success(
      await tool.execute({
        context,
        arguments: {project_id: projectId, config_path: 'ci.yml', ref: 'main'},
      }),
    );

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.length).toBeLessThan(100);
    expect(result.errors[0]).toEqual(errors[0]);
    expect(result.errors_total).toBe(100);
    expect(result.errors_truncated).toBe(true);
  });

  test.each<[Record<string, unknown>, string]>([
    [{project_id: projectId, config_path: 'ci.yml'}, 'neither ref nor content'],
    [
      {project_id: projectId, config_path: 'ci.yml', content: 'x', commit: COMMIT},
      'commit without ref',
    ],
    [
      {project_id: projectId, config_path: 'ci.yml', ref: 'main', event_ids: [eventId]},
      'event_ids without trigger',
    ],
    [
      {
        project_id: projectId,
        config_path: 'ci.yml',
        ref: 'main',
        trigger: 'on_pr',
        event_ids: [eventId, eventId],
      },
      'duplicate event_ids',
    ],
    [
      {
        project_id: projectId,
        config_path: 'ci.yml',
        ref: 'main',
        trigger: 'on_pr',
        event_ids: Array.from({length: 51}, (_, index) => uuid(100 + index)),
      },
      'more than 50 event_ids',
    ],
  ])('rejects %o (%s)', async (args) => {
    const {checkWorkflow, tool} = setup();

    const response = await tool.execute({context, arguments: args});

    expect(response).toMatchObject({ok: false, error: {code: 'invalid-request'}});
    expect(checkWorkflow).not.toHaveBeenCalled();
  });

  test.each([
    ['project-not-found', {projectId}, {code: 'project-not-found'}],
    [
      'trigger-not-found',
      {triggerKey: 'missing', availableTriggerKeys: ['on_pr']},
      {code: 'trigger-not-found', details: {available_trigger_keys: ['on_pr']}},
    ],
    ['event-ids-not-allowed', {source: 'manual'}, {code: 'event-ids-not-allowed'}],
  ] as const)('maps the %s refusal', async (code, details, expected) => {
    const {checkWorkflow, tool} = setup();
    checkWorkflow.mockRejectedValue(
      createInterModuleKnownError(
        triggersInterModuleContract.methods.checkWorkflow,
        code as 'project-not-found',
        details as never,
      ),
    );

    const response = await tool.execute({
      context,
      arguments: {project_id: projectId, config_path: 'ci.yml', ref: 'main', trigger: 'missing'},
    });

    expect(response).toMatchObject({ok: false, error: expected});
  });
});

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
}
