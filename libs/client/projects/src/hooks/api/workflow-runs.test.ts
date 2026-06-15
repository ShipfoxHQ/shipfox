import {configureApiClient} from '@shipfox/client-api';
import {fireManualWorkflow, getWorkflowRun, workflowRunsQueryKeys} from './workflow-runs.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {'content-type': 'application/json'},
    status: 200,
    ...init,
  });
}

describe('fireManualWorkflow', () => {
  beforeEach(() => {
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl: undefined});
  });

  test('posts to /workflow-definitions/:id/fire-manual with an empty body when no inputs', async () => {
    let requestBody: unknown;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      requestBody = await (input as Request).clone().json();
      return jsonResponse({run_id: '66666666-6666-4666-8666-666666666666'}, {status: 201});
    });
    configureApiClient({fetchImpl});

    const result = await fireManualWorkflow({
      definitionId: '55555555-5555-4555-8555-555555555555',
    });

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(result.run_id).toBe('66666666-6666-4666-8666-666666666666');
    expect(request.url).toBe(
      'https://api.example.test/workflow-definitions/55555555-5555-4555-8555-555555555555/fire-manual',
    );
    expect(request.method).toBe('POST');
    expect(requestBody).toEqual({});
  });

  test('forwards inputs when provided', async () => {
    let requestBody: unknown;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      requestBody = await (input as Request).clone().json();
      return jsonResponse({run_id: '66666666-6666-4666-8666-666666666666'}, {status: 201});
    });
    configureApiClient({fetchImpl});

    await fireManualWorkflow({
      definitionId: '55555555-5555-4555-8555-555555555555',
      inputs: {env: 'production'},
    });

    expect(requestBody).toEqual({inputs: {env: 'production'}});
  });
});

describe('getWorkflowRun', () => {
  beforeEach(() => {
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl: undefined});
  });

  test('gets /workflows/runs/:id', async () => {
    const runId = '66666666-6666-4666-8666-666666666666';
    const requests: Request[] = [];
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      requests.push(input as Request);
      return Promise.resolve(
        jsonResponse({
          id: runId,
          project_id: '11111111-1111-4111-8111-111111111111',
          definition_id: '22222222-2222-4222-8222-222222222222',
          name: 'Deploy',
          status: 'running',
          trigger_source: 'manual',
          trigger_event: 'fire',
          trigger_payload: {source: 'manual'},
          inputs: null,
          duration_ms: 0,
          created_at: '2026-06-15T10:00:00.000Z',
          updated_at: '2026-06-15T10:00:00.000Z',
          jobs: [],
        }),
      );
    });
    configureApiClient({fetchImpl});

    const result = await getWorkflowRun({runId});

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const request = requests[0];
    expect(request).toBeDefined();
    if (!request) throw new Error('Expected getWorkflowRun to issue a request');
    expect(request.url).toBe(`https://api.example.test/workflows/runs/${runId}`);
    expect(request.method).toBe('GET');
    expect(result.id).toBe(runId);
  });

  test('uses a stable detail query key', () => {
    const runId = '66666666-6666-4666-8666-666666666666';

    const key = workflowRunsQueryKeys.detail(runId);

    expect(key).toEqual(['workflow-runs', 'detail', runId]);
  });
});
