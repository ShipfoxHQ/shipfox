import {SHIPFOX_PROVIDER} from '@shipfox/api-integration-shipfox-dto';
import {findMatchingSubscriptions} from '#db/subscriptions.js';
import {receivedEventFactory, triggerSubscriptionFactory} from '#test/index.js';
import {matchTriggerEvent} from './match-trigger-event.js';

describe('matchTriggerEvent', () => {
  test('matches an event whose source, name and filter fit the trigger', () => {
    const event = receivedEventFactory.build({payload: {ref: 'refs/heads/main'}});

    const match = matchTriggerEvent({
      trigger: {source: 'github', event: 'push', filter: 'event.ref == "refs/heads/main"'},
      event,
    });

    expect(match.result).toBe('matched');
  });

  test('matches without a filter', () => {
    const match = matchTriggerEvent({
      trigger: {source: 'github', event: 'push'},
      event: receivedEventFactory.build(),
    });

    expect(match.result).toBe('matched');
  });

  test('reports a false filter as filtered', () => {
    const match = matchTriggerEvent({
      trigger: {source: 'github', event: 'push', filter: 'event.ref == "refs/heads/main"'},
      event: receivedEventFactory.build({payload: {ref: 'refs/heads/other'}}),
    });

    expect(match.result).toBe('filtered');
  });

  test('reports a filter that fails to evaluate with its reason and diagnostic', () => {
    const match = matchTriggerEvent({
      trigger: {source: 'github', event: 'push', filter: 'event.missing.size() > 1'},
      event: receivedEventFactory.build({payload: {ref: 'refs/heads/main'}}),
    });

    expect(match).toMatchObject({
      result: 'filter-error',
      reason: 'Trigger filter evaluation failed',
      diagnostic: {version: 1, code: expect.any(String)},
    });
  });

  test.each([
    ['another origin', {origin: 'dev' as const}],
    ['another source', {source: 'gitlab'}],
    ['another event name', {event: 'pull_request'}],
  ])('reports an event from %s as a mismatch', (_name, overrides) => {
    const match = matchTriggerEvent({
      trigger: {source: 'github', event: 'push'},
      event: receivedEventFactory.build(overrides),
    });

    expect(match.result).toBe('event-mismatch');
  });

  test('reports a pruned payload as unavailable', () => {
    const match = matchTriggerEvent({
      trigger: {source: 'github', event: 'push'},
      event: receivedEventFactory.build({payload: null}),
    });

    expect(match.result).toBe('payload-unavailable');
  });

  test('gives older Shipfox events the run link a new event carries', () => {
    const runId = crypto.randomUUID();
    const match = matchTriggerEvent({
      trigger: {source: 'shipfox', event: 'run.completed', filter: 'has(event.run.url)'},
      event: receivedEventFactory.build({
        provider: SHIPFOX_PROVIDER,
        source: 'shipfox',
        event: 'run.completed',
        payload: {run: {id: runId}},
      }),
    });

    expect(match.result).toBe('matched');
  });

  describe('source and event rules', () => {
    test.each([
      ['a source-only trigger', undefined, 'push', true],
      ['a source-only trigger on another event', undefined, 'pull_request', true],
      ['an event-named trigger', 'push', 'push', true],
      ['an event-named trigger on another event', 'push', 'pull_request', false],
    ])('agree with dispatch for %s', async (_name, triggerEvent, eventName, matches) => {
      const workspaceId = crypto.randomUUID();
      const subscription = await triggerSubscriptionFactory.create({
        workspaceId,
        source: 'github',
        event: triggerEvent ?? null,
      });
      const event = receivedEventFactory.build({workspaceId, source: 'github', event: eventName});

      const dispatched = await findMatchingSubscriptions({
        workspaceId,
        source: event.source,
        event: event.event,
      });
      const match = matchTriggerEvent({
        trigger: {source: 'github', ...(triggerEvent === undefined ? {} : {event: triggerEvent})},
        event,
      });

      expect(dispatched.map((row) => row.id).includes(subscription.id)).toBe(matches);
      expect(match.result === 'matched').toBe(matches);
    });
  });
});
