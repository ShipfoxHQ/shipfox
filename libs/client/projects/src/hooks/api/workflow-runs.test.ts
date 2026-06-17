import {configureApiClient} from '@shipfox/client-api';
import {fireManualWorkflow, getWorkflowRun} from './workflow-runs.js';

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

  test('requests the workflow run detail endpoint', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        id: '66666666-6666-4666-8666-666666666666',
        jobs: [],
      }),
    );
    configureApiClient({fetchImpl});

    const result = await getWorkflowRun({runId: '66666666-6666-4666-8666-666666666666'});

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(result.id).toBe('66666666-6666-4666-8666-666666666666');
    expect(request.url).toBe(
      'https://api.example.test/workflows/runs/66666666-6666-4666-8666-666666666666',
    );
    expect(request.method).toBe('GET');
  });
});
