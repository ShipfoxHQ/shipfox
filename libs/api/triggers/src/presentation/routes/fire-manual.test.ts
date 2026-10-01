import {buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import {
  type WorkflowsModuleClient,
  workflowsInterModuleContract,
} from '@shipfox/api-workflows-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {triggerSubscriptionFactory} from '#test/index.js';

const fireManualTriggerMock = vi.hoisted(() => vi.fn());

vi.mock('#core/fire-manual.js', () => ({
  fireManualTrigger: fireManualTriggerMock,
}));

const {createFireManualTriggerRoute} = await import('./fire-manual.js');

const workflows = {} as WorkflowsModuleClient;

describe('POST /:definitionId/fire-manual', () => {
  let app: FastifyInstance;
  let workspaceId: string;
  let memberships: Array<{
    workspaceId: string;
    role: 'admin';
    workspaceStatus: 'active' | 'suspended' | 'deleted';
  }>;

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
    app.post('/:definitionId/fire-manual', createFireManualTriggerRoute(workflows));
    await app.ready();
  });

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    memberships = [{workspaceId, role: 'admin', workspaceStatus: 'active'}];
    fireManualTriggerMock.mockReset();
  });

  test('returns 201 with the created run id', async () => {
    const definitionId = crypto.randomUUID();
    const runId = crypto.randomUUID();
    await triggerSubscriptionFactory.create({workspaceId, workflowDefinitionId: definitionId});
    fireManualTriggerMock.mockResolvedValue({
      id: runId,
      name: 'Manual run',
      deduplicated: false,
    });

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
    fireManualTriggerMock.mockRejectedValue(
      createInterModuleKnownError(
        workflowsInterModuleContract.methods.startRunFromTrigger,
        'interpolation-unresolvable',
        {definitionId, field: 'env', source: 'event.ref', envKey: 'REF'},
      ),
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

  test('names the unusable agent setting and where it is set in the 422 details', async () => {
    const definitionId = crypto.randomUUID();
    await triggerSubscriptionFactory.create({workspaceId, workflowDefinitionId: definitionId});
    fireManualTriggerMock.mockRejectedValue(
      createInterModuleKnownError(
        workflowsInterModuleContract.methods.startRunFromTrigger,
        'agent-config-unresolvable',
        {
          definitionId,
          reason: 'model-unknown',
          model: 'gpt-9',
          provider: 'openai',
          jobKey: 'review',
          step: {key: 'summarize', name: 'Summarize', index: 3},
        },
      ),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/${definitionId}/fire-manual`,
      payload: {},
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({
      code: 'agent-config-unresolvable',
      details: {
        definition_id: definitionId,
        reason: 'model-unknown',
        model: 'gpt-9',
        provider: 'openai',
        job_key: 'review',
        step: {key: 'summarize', name: 'Summarize', index: 3},
      },
    });
  });

  test('names the unusable integration and where it is set in the 422 details', async () => {
    const definitionId = crypto.randomUUID();
    await triggerSubscriptionFactory.create({workspaceId, workflowDefinitionId: definitionId});
    fireManualTriggerMock.mockRejectedValue(
      createInterModuleKnownError(
        workflowsInterModuleContract.methods.startRunFromTrigger,
        'agent-integration-materialization-failed',
        {
          reason: 'connection-missing',
          connection: 'team-slack',
          jobKey: 'review',
          step: {key: 'notify', name: 'Notify', index: 2},
        },
      ),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/${definitionId}/fire-manual`,
      payload: {},
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({
      code: 'agent-integration-materialization-failed',
      details: {
        reason: 'connection-missing',
        connection: 'team-slack',
        job_key: 'review',
        step: {key: 'notify', name: 'Notify', index: 2},
      },
    });
  });

  test('names the missing variable and where it is read in the 422 details', async () => {
    const definitionId = crypto.randomUUID();
    await triggerSubscriptionFactory.create({workspaceId, workflowDefinitionId: definitionId});
    fireManualTriggerMock.mockRejectedValue(
      createInterModuleKnownError(
        workflowsInterModuleContract.methods.startRunFromTrigger,
        'interpolation-unresolvable',
        {
          definitionId,
          field: 'job.if',
          source: 'vars.E2E_SCHEDULE_ENABLED',
          variableKey: 'E2E_SCHEDULE_ENABLED',
          jobKey: 'e2e',
          step: {key: 'deploy', name: 'Deploy', index: 2},
        },
      ),
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
        field: 'job.if',
        source: 'vars.E2E_SCHEDULE_ENABLED',
        variable_key: 'E2E_SCHEDULE_ENABLED',
        job_key: 'e2e',
        step: {key: 'deploy', name: 'Deploy', index: 2},
      },
    });
  });

  test('maps an oversized workflow source snapshot to 422 with byte details', async () => {
    const definitionId = crypto.randomUUID();
    await triggerSubscriptionFactory.create({workspaceId, workflowDefinitionId: definitionId});
    fireManualTriggerMock.mockRejectedValue(
      createInterModuleKnownError(
        workflowsInterModuleContract.methods.startRunFromTrigger,
        'source-snapshot-too-large',
        {limitBytes: 1_000_000, measuredBytes: 1_000_001},
      ),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/${definitionId}/fire-manual`,
      payload: {},
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({
      code: 'source-snapshot-too-large',
      details: {limit_bytes: 1_000_000, measured_bytes: 1_000_001},
    });
  });

  test.each([
    ['definition-not-found', {definitionId: crypto.randomUUID()}, 404],
    ['project-mismatch', {}, 409],
  ] as const)('maps %s from startRunFromTrigger to %i', async (code, details, status) => {
    const definitionId = crypto.randomUUID();
    await triggerSubscriptionFactory.create({workspaceId, workflowDefinitionId: definitionId});
    fireManualTriggerMock.mockRejectedValue(
      createInterModuleKnownError(
        workflowsInterModuleContract.methods.startRunFromTrigger,
        code,
        details as {definitionId: string} | Record<string, never>,
      ),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/${definitionId}/fire-manual`,
      payload: {},
    });

    expect(res.statusCode).toBe(status);
    expect(res.json().code).toBe(code);
  });

  test('maps an oversized execution payload to 422 with field and byte details', async () => {
    const definitionId = crypto.randomUUID();
    await triggerSubscriptionFactory.create({workspaceId, workflowDefinitionId: definitionId});
    fireManualTriggerMock.mockRejectedValue(
      createInterModuleKnownError(
        workflowsInterModuleContract.methods.startRunFromTrigger,
        'workflow-execution-payload-too-large',
        {field: 'resolved_config', limitBytes: 1_000, measuredBytes: 1_500, overshootBytes: 500},
      ),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/${definitionId}/fire-manual`,
      payload: {},
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({
      code: 'workflow-execution-payload-too-large',
      details: {field: 'resolved_config', limit_bytes: 1_000, measured_bytes: 1_500},
    });
  });

  test('returns workspace-suspended for a suspended membership claim', async () => {
    const definitionId = crypto.randomUUID();
    await triggerSubscriptionFactory.create({workspaceId, workflowDefinitionId: definitionId});
    memberships = [{workspaceId, role: 'admin', workspaceStatus: 'suspended'}];

    const res = await app.inject({
      method: 'POST',
      url: `/${definitionId}/fire-manual`,
      payload: {},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('workspace-suspended');
    expect(fireManualTriggerMock).not.toHaveBeenCalled();
  });

  test('maps suspended workspace to 409', async () => {
    const definitionId = crypto.randomUUID();
    await triggerSubscriptionFactory.create({workspaceId, workflowDefinitionId: definitionId});
    fireManualTriggerMock.mockRejectedValue(
      createInterModuleKnownError(
        workflowsInterModuleContract.methods.startRunFromTrigger,
        'workspace-suspended',
        {workspaceId},
      ),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/${definitionId}/fire-manual`,
      payload: {},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({code: 'workspace-suspended'});
  });

  test('maps admission denial to 409 with required action details', async () => {
    const definitionId = crypto.randomUUID();
    const reason = 'billing-payment-method-required';
    const requiredAction = {
      reason,
      message: 'Add a payment method to continue.',
      url: '/settings/billing',
    };
    await triggerSubscriptionFactory.create({workspaceId, workflowDefinitionId: definitionId});
    fireManualTriggerMock.mockRejectedValue(
      createInterModuleKnownError(
        workflowsInterModuleContract.methods.startRunFromTrigger,
        'admission-denied',
        {workspaceId, reason, requiredAction},
      ),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/${definitionId}/fire-manual`,
      payload: {},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      code: 'admission-denied',
      details: {workspace_id: workspaceId, reason, required_action: requiredAction},
    });
  });

  test('keeps the intent of an admission denial required action', async () => {
    const definitionId = crypto.randomUUID();
    const reason = 'workspace-limit';
    const requiredAction = {
      reason,
      message: 'Contact us',
      url: 'mailto:support@example.test',
      intent: 'contact-support',
    };
    await triggerSubscriptionFactory.create({workspaceId, workflowDefinitionId: definitionId});
    fireManualTriggerMock.mockRejectedValue(
      createInterModuleKnownError(
        workflowsInterModuleContract.methods.startRunFromTrigger,
        'admission-denied',
        {workspaceId, reason, requiredAction},
      ),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/${definitionId}/fire-manual`,
      payload: {},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().details.required_action).toEqual(requiredAction);
  });

  test('maps missing workspace to 404', async () => {
    const definitionId = crypto.randomUUID();
    await triggerSubscriptionFactory.create({workspaceId, workflowDefinitionId: definitionId});
    fireManualTriggerMock.mockRejectedValue(
      createInterModuleKnownError(
        workflowsInterModuleContract.methods.startRunFromTrigger,
        'workspace-not-found',
        {workspaceId},
      ),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/${definitionId}/fire-manual`,
      payload: {},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({code: 'workspace-not-found'});
  });

  test('maps deleted workspace to 404', async () => {
    const definitionId = crypto.randomUUID();
    await triggerSubscriptionFactory.create({workspaceId, workflowDefinitionId: definitionId});
    fireManualTriggerMock.mockRejectedValue(
      createInterModuleKnownError(
        workflowsInterModuleContract.methods.startRunFromTrigger,
        'workspace-deleted',
        {workspaceId},
      ),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/${definitionId}/fire-manual`,
      payload: {},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({code: 'workspace-deleted'});
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
