import {createLocalWorkflowsService, LocalWorkflowsError} from './local-workflows.js';

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: {'content-type': 'application/json'},
      ...init,
    }),
  );
}

describe('local workflows service', () => {
  const projectId = '11111111-1111-4111-8111-111111111111';

  test('forwards fake alerts to the local-service fake monitoring endpoint', async () => {
    const fetchImpl = vi.fn(() =>
      jsonResponse({
        status: 'completed',
        run: {
          run: {run_id: 'run-001', workflow_name: 'restore_checkout', status: 'completed'},
          actions: [],
          events: [],
        },
      }),
    );
    const service = createLocalWorkflowsService({
      baseUrl: 'http://127.0.0.1:8765',
      fetchImpl,
      runIdFactory: () => 'run-001',
    });

    const result = await service.triggerFakeAlert({
      id: 'alert-001',
      severity: 'critical',
      message: 'checkout conversion degraded',
    });

    expect(result.run_id).toBe('run-001');
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL('http://127.0.0.1:8765/v0/integrations/fake-monitoring/alerts'),
      {
        method: 'POST',
        body: JSON.stringify({
          id: 'alert-001',
          severity: 'critical',
          message: 'checkout conversion degraded',
          run_id: 'run-001',
        }),
        headers: {'content-type': 'application/json'},
        signal: expect.any(AbortSignal),
      },
    );
  });

  test('scopes platform-generated run ids to the requested project', async () => {
    const fetchImpl = vi.fn(() =>
      jsonResponse({
        status: 'completed',
        run: {
          run: {
            run_id: `local-workflows-${projectId}-run-001`,
            workflow_name: 'restore_checkout',
            status: 'completed',
          },
          actions: [],
          events: [],
        },
      }),
    );
    const service = createLocalWorkflowsService({
      fetchImpl,
      runIdFactory: () => 'run-001',
    });

    const result = await service.triggerFakeAlert(
      {
        id: 'alert-001',
        severity: 'critical',
        message: 'checkout conversion degraded',
      },
      projectId,
    );

    expect(result.run_id).toBe(`local-workflows-${projectId}-run-001`);
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        body: expect.stringContaining(`local-workflows-${projectId}-run-001`),
      }),
    );
  });

  test('filters run lists to the requested project prefix', async () => {
    const service = createLocalWorkflowsService({
      fetchImpl: vi.fn(() =>
        jsonResponse({
          runs: [
            {
              run_id: `local-workflows-${projectId}-run-001`,
              workflow_name: 'restore_checkout',
              status: 'completed',
            },
            {
              run_id: 'local-workflows-22222222-2222-4222-8222-222222222222-run-002',
              workflow_name: 'restore_checkout',
              status: 'completed',
            },
          ],
        }),
      ),
    });

    const result = await service.listRuns(projectId);

    expect(result.runs).toHaveLength(1);
    expect(result.runs[0]?.run_id).toBe(`local-workflows-${projectId}-run-001`);
  });

  test('classifies unregistered trigger rejections', async () => {
    const service = createLocalWorkflowsService({
      fetchImpl: vi.fn(() =>
        jsonResponse(
          {
            status: 'input_rejected',
            input_error: {
              kind: 'unknown_trigger_id',
              trigger_id: 'restore_checkout_exec.fox::trigger:checkout_degraded',
            },
          },
          {status: 422},
        ),
      ),
      runIdFactory: () => 'run-001',
    });

    const result = service.triggerFakeAlert({
      id: 'alert-001',
      severity: 'critical',
      message: 'checkout conversion degraded',
    });

    await expect(result).rejects.toMatchObject({
      code: 'local-service-input-rejected',
      status: 422,
    });
  });

  test('classifies malformed local-service responses', async () => {
    const service = createLocalWorkflowsService({
      fetchImpl: vi.fn(() => jsonResponse({unexpected: true})),
    });

    const result = service.listRuns();

    await expect(result).rejects.toMatchObject({
      code: 'local-service-malformed-response',
      status: 502,
    });
  });

  test('forwards opaque local-service ids without URL-encoding them again', async () => {
    const fetchImpl = vi.fn(() =>
      jsonResponse({
        preparation_id: 'prep-1',
        workflow: {workflow_id: 'restore_checkout_exec.fox::workflow:restore_checkout'},
        triggers: [],
        required_services: [],
        action_requirements: [],
        source: {source_name: 'restore_checkout_exec.fox', source_text: 'source'},
      }),
    );
    const service = createLocalWorkflowsService({baseUrl: 'http://127.0.0.1:8765', fetchImpl});

    await service.getWorkflow('restore_checkout_exec.fox::workflow:restore_checkout');

    expect(fetchImpl).toHaveBeenCalledWith(
      new URL(
        'http://127.0.0.1:8765/v0/foxlang/workflows/restore_checkout_exec.fox::workflow:restore_checkout',
      ),
      expect.any(Object),
    );
  });

  test('preserves path prefixes configured on the local-service base URL', async () => {
    const fetchImpl = vi.fn(() => jsonResponse({workflows: []}));
    const service = createLocalWorkflowsService({
      baseUrl: 'http://127.0.0.1:8765/proxy/root',
      fetchImpl,
    });

    await service.listWorkflows();

    expect(fetchImpl).toHaveBeenCalledWith(
      new URL('http://127.0.0.1:8765/proxy/root/v0/foxlang/workflows'),
      expect.any(Object),
    );
  });

  test('rejects opaque ids with path characters before forwarding them', async () => {
    const fetchImpl = vi.fn(() => jsonResponse({}));
    const service = createLocalWorkflowsService({baseUrl: 'http://127.0.0.1:8765', fetchImpl});

    const result = service.getWorkflow('../restore_checkout');

    await expect(result).rejects.toMatchObject({
      code: 'local-service-error',
      status: 400,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test.each([
    'restore_checkout?bad=true',
    'restore_checkout#fragment',
  ])('rejects opaque ids with URL delimiter characters before forwarding them', async (workflowId) => {
    const fetchImpl = vi.fn(() => jsonResponse({}));
    const service = createLocalWorkflowsService({baseUrl: 'http://127.0.0.1:8765', fetchImpl});

    const result = service.getWorkflow(workflowId);

    await expect(result).rejects.toMatchObject({
      code: 'local-service-error',
      status: 400,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('rejects run detail requests outside the requested project', async () => {
    const fetchImpl = vi.fn(() => jsonResponse({}));
    const service = createLocalWorkflowsService({baseUrl: 'http://127.0.0.1:8765', fetchImpl});

    const result = service.getRun(
      'local-workflows-22222222-2222-4222-8222-222222222222-run-002',
      projectId,
    );

    await expect(result).rejects.toMatchObject({
      code: 'local-service-error',
      status: 404,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('classifies unavailable local-service requests', async () => {
    const service = createLocalWorkflowsService({
      fetchImpl: vi.fn(() => Promise.reject(new TypeError('fetch failed'))),
    });

    const result = service.listWorkflows();

    await expect(result).rejects.toBeInstanceOf(LocalWorkflowsError);
    await expect(result).rejects.toMatchObject({
      code: 'local-service-unavailable',
      status: 503,
    });
  });
});
