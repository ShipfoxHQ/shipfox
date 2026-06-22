import {buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {decisionFactory, receivedEventFactory} from '#test/index.js';
import {getTriggerEventRoute} from './get-trigger-event.js';

describe('GET /trigger-events/:id', () => {
  let app: FastifyInstance;
  let workspaceId: string;
  let memberships: Array<{workspaceId: string; role: 'admin'}>;

  beforeAll(async () => {
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.addHook('onRequest', (request, _reply, done) => {
      setUserContext(
        request,
        buildUserContext({userId: crypto.randomUUID(), email: 'user@example.com', memberships}),
      );
      done();
    });
    app.get('/trigger-events/:id', getTriggerEventRoute);
    await app.ready();
  });

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    memberships = [{workspaceId, role: 'admin'}];
  });

  test('returns the event with its decisions and full payload', async () => {
    const event = await receivedEventFactory.create({
      workspaceId,
      outcome: 'routed',
      matchedCount: 2,
      payload: {ref: 'refs/heads/main', headCommitSha: 'abc123'},
    });
    const triggered = await decisionFactory.create({
      receivedEventId: event.id,
      decision: 'triggered',
      runName: 'deploy',
    });
    const errored = await decisionFactory.create({
      receivedEventId: event.id,
      decision: 'errored',
      runId: null,
      runName: null,
      reason: 'boom',
    });

    const res = await app.inject({method: 'GET', url: `/trigger-events/${event.id}`});

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(event.id);
    expect(body.matched_count).toBe(2);
    expect(body.payload).toEqual({ref: 'refs/heads/main', headCommitSha: 'abc123'});
    expect(body.decisions.map((decision: {id: string}) => decision.id)).toEqual([
      triggered.id,
      errored.id,
    ]);
    expect(body.decisions[1].decision).toBe('errored');
    expect(body.decisions[1].run_id).toBeNull();
    expect(body.decisions[1].reason).toBe('boom');
  });

  test('returns an empty decisions list for a discarded event', async () => {
    const event = await receivedEventFactory.create({
      workspaceId,
      outcome: 'discarded',
      matchedCount: 0,
    });

    const res = await app.inject({method: 'GET', url: `/trigger-events/${event.id}`});

    expect(res.statusCode).toBe(200);
    expect(res.json().decisions).toEqual([]);
  });

  test('returns 404 for an unknown event id', async () => {
    const res = await app.inject({method: 'GET', url: `/trigger-events/${crypto.randomUUID()}`});

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not-found');
  });

  test('returns 404 for an event in another workspace', async () => {
    const event = await receivedEventFactory.create({workspaceId: crypto.randomUUID()});

    const res = await app.inject({method: 'GET', url: `/trigger-events/${event.id}`});

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not-found');
  });

  test('rejects a non-uuid id', async () => {
    const res = await app.inject({method: 'GET', url: '/trigger-events/not-a-uuid'});

    expect(res.statusCode).toBe(400);
  });
});
