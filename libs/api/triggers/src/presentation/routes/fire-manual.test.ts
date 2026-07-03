import {buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import type {WorkflowRun} from '@shipfox/api-workflows';
import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {triggerSubscriptionFactory} from '#test/index.js';

const fireManualSubscriptionMock = vi.hoisted(() => vi.fn());

vi.mock('@shipfox/api-workflows', () => {
  class InterpolationUnresolvableError extends Error {
    readonly field: string;
    readonly source: string;
    readonly envKey?: string;

    constructor(
      definitionId: string,
      params: {readonly field: string; readonly source: string; readonly envKey?: string},
    ) {
      super(`Workflow interpolation cannot be resolved for definition ${definitionId}`);
      this.name = 'InterpolationUnresolvableError';
      this.field = params.field;
      this.source = params.source;
      if (params.envKey !== undefined) this.envKey = params.envKey;
    }
  }
  return {InterpolationUnresolvableError};
});

vi.mock('#core/fire-manual.js', () => ({
  fireManualSubscription: fireManualSubscriptionMock,
}));

import {InterpolationUnresolvableError} from '@shipfox/api-workflows';

const {fireManualTriggerRoute} = await import('./fire-manual.js');

describe('POST /:definitionId/fire-manual', () => {
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
    app.post('/:definitionId/fire-manual', fireManualTriggerRoute);
    await app.ready();
  });

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    memberships = [{workspaceId, role: 'admin'}];
    fireManualSubscriptionMock.mockReset();
  });

  test('returns 201 with the created run id', async () => {
    const definitionId = crypto.randomUUID();
    const runId = crypto.randomUUID();
    await triggerSubscriptionFactory.create({workspaceId, workflowDefinitionId: definitionId});
    fireManualSubscriptionMock.mockResolvedValue({id: runId} satisfies Pick<WorkflowRun, 'id'>);

    const res = await app.inject({
      method: 'POST',
      url: `/${definitionId}/fire-manual`,
      payload: {},
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({workflow_run_id: runId});
  });

  test('maps unresolvable workflow interpolation to 422', async () => {
    const definitionId = crypto.randomUUID();
    await triggerSubscriptionFactory.create({workspaceId, workflowDefinitionId: definitionId});
    fireManualSubscriptionMock.mockRejectedValue(
      new InterpolationUnresolvableError(definitionId, {
        field: 'env',
        source: 'event.ref',
        envKey: 'REF',
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/${definitionId}/fire-manual`,
      payload: {},
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({
      code: 'workflow-interpolation-unresolvable',
      details: {
        field: 'env',
        source: 'event.ref',
        env_key: 'REF',
      },
    });
  });

  test('returns 404 when the manual trigger is unavailable', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/${crypto.randomUUID()}/fire-manual`,
      payload: {},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('manual-trigger-not-found');
  });
});
