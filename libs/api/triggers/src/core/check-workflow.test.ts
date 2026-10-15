import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {triggersReceivedEvents} from '#db/schema/received-events.js';
import {receivedEventFactory} from '#test/index.js';
import {checkWorkflow} from './check-workflow.js';
import {CheckWorkflowEventIdsNotAllowedError, DevRunTriggerNotFoundError} from './errors.js';

const COMMIT = 'a'.repeat(40);
const validateDefinitionAtRef = vi.fn();
const definitions = {validateDefinitionAtRef};

function validated(overrides: Record<string, unknown> = {}) {
  return {
    ref: 'main',
    commit: COMMIT,
    valid: true,
    errors: [],
    errorCount: 0,
    warnings: [],
    triggers: {
      on_push: {source: 'github', event: 'push', filter: 'event.ref == "refs/heads/main"'},
      on_demand: {source: 'manual', event: 'fire'},
    },
    ...overrides,
  };
}

function params(workspaceId: string, overrides: Record<string, unknown> = {}) {
  return {
    definitions,
    workspaceId,
    projectId: crypto.randomUUID(),
    content: 'name: CI\n',
    configPath: '.shipfox/workflows/ci.yml',
    ...overrides,
  };
}

function journalFor(workspaceId: string) {
  return db()
    .select({id: triggersReceivedEvents.id})
    .from(triggersReceivedEvents)
    .where(eq(triggersReceivedEvents.workspaceId, workspaceId));
}

beforeEach(() => {
  validateDefinitionAtRef.mockReset();
});

describe('checkWorkflow', () => {
  test('passes the workspace and the pinned commit to validation', async () => {
    const workspaceId = crypto.randomUUID();
    validateDefinitionAtRef.mockResolvedValue(validated());
    const input = params(workspaceId, {ref: 'main', commit: COMMIT});

    const result = await checkWorkflow(input);

    expect(validateDefinitionAtRef).toHaveBeenCalledWith({
      workspaceId,
      projectId: input.projectId,
      ref: 'main',
      content: 'name: CI\n',
      configPath: '.shipfox/workflows/ci.yml',
      expectedCommit: COMMIT,
    });
    expect(result).toEqual(validated());
  });

  test('returns an invalid definition without checking the trigger or events', async () => {
    const workspaceId = crypto.randomUUID();
    const invalid = validated({
      valid: false,
      errors: [{message: 'jobs is required'}],
      errorCount: 1,
      triggers: {},
    });
    validateDefinitionAtRef.mockResolvedValue(invalid);

    const result = await checkWorkflow(
      params(workspaceId, {triggerKey: 'on_push', eventIds: [crypto.randomUUID()]}),
    );

    expect(result).toEqual(invalid);
  });

  test('checks that a trigger exists when no events are given', async () => {
    const workspaceId = crypto.randomUUID();
    validateDefinitionAtRef.mockResolvedValue(validated());

    await expect(checkWorkflow(params(workspaceId, {triggerKey: 'missing'}))).rejects.toThrow(
      new DevRunTriggerNotFoundError('missing', ['on_push', 'on_demand']),
    );
    await expect(checkWorkflow(params(workspaceId, {triggerKey: 'on_push'}))).resolves.toEqual(
      validated(),
    );
  });

  test.each(['manual', 'cron'])('refuses events for a %s trigger', async (source) => {
    const workspaceId = crypto.randomUUID();
    validateDefinitionAtRef.mockResolvedValue(
      validated({triggers: {scheduled: {source, event: 'tick'}}}),
    );

    await expect(
      checkWorkflow(
        params(workspaceId, {triggerKey: 'scheduled', eventIds: [crypto.randomUUID()]}),
      ),
    ).rejects.toThrow(CheckWorkflowEventIdsNotAllowedError);
  });

  test('reports one result per event in input order and writes no journal entry', async () => {
    const workspaceId = crypto.randomUUID();
    const matched = await receivedEventFactory.create({
      workspaceId,
      payload: {ref: 'refs/heads/main'},
    });
    const filtered = await receivedEventFactory.create({
      workspaceId,
      payload: {ref: 'refs/heads/other'},
    });
    const filterError = await receivedEventFactory.create({workspaceId, payload: {ref: null}});
    const mismatch = await receivedEventFactory.create({workspaceId, event: 'pull_request'});
    const pruned = await receivedEventFactory.create({workspaceId, payload: null});
    const otherWorkspace = await receivedEventFactory.create({payload: {ref: 'refs/heads/main'}});
    const unknown = crypto.randomUUID();
    validateDefinitionAtRef.mockResolvedValue(
      validated({
        triggers: {
          on_push: {
            source: 'github',
            event: 'push',
            filter: 'event.ref.startsWith("refs/heads/main")',
          },
        },
      }),
    );
    const eventIds = [
      pruned.id,
      matched.id,
      unknown,
      filtered.id,
      otherWorkspace.id,
      filterError.id,
      mismatch.id,
    ];
    const journalBefore = await journalFor(workspaceId);

    const result = await checkWorkflow(params(workspaceId, {triggerKey: 'on_push', eventIds}));

    expect(result.events?.map((event) => [event.eventId, event.result])).toEqual([
      [pruned.id, 'payload-unavailable'],
      [matched.id, 'matched'],
      [unknown, 'not-found'],
      [filtered.id, 'filtered'],
      [otherWorkspace.id, 'not-found'],
      [filterError.id, 'filter-error'],
      [mismatch.id, 'event-mismatch'],
    ]);
    expect(result.events?.[1]).toEqual({
      eventId: matched.id,
      result: 'matched',
      source: 'github',
      event: 'push',
      receivedAt: matched.receivedAt,
    });
    expect(result.events?.[2]).toEqual({eventId: unknown, result: 'not-found'});
    expect(result.events?.[5]).toMatchObject({
      reason: 'Trigger filter evaluation failed',
      diagnostic: {version: 1},
    });
    expect(result.eventCounts).toEqual({
      matched: 1,
      filtered: 1,
      'filter-error': 1,
      'event-mismatch': 1,
      'payload-unavailable': 1,
      'not-found': 2,
    });
    expect(await journalFor(workspaceId)).toEqual(journalBefore);
  });
});
