import {configureApiClient} from '@shipfox/client-api';
import {createWorkflowRun} from './workflow-runs.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {'content-type': 'application/json'},
    status: 200,
    ...init,
  });
}

describe('createWorkflowRun', () => {
  beforeEach(() => {
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl: undefined});
  });

  test('posts project and definition ids', async () => {
    let requestBody: unknown;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      requestBody = await (input as Request).clone().json();
      return jsonResponse(
        {
          id: '66666666-6666-4666-8666-666666666666',
          project_id: '44444444-4444-4444-8444-444444444444',
          definition_id: '55555555-5555-4555-8555-555555555555',
          status: 'pending',
          trigger_context: {type: 'manual'},
          inputs: null,
          created_at: '2026-05-07T01:01:00.000Z',
          updated_at: '2026-05-07T01:01:00.000Z',
        },
        {status: 201},
      );
    });
    configureApiClient({fetchImpl});
    const body = {
      project_id: '44444444-4444-4444-8444-444444444444',
      definition_id: '55555555-5555-4555-8555-555555555555',
    };

    const result = await createWorkflowRun(body);

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(result.status).toBe('pending');
    expect(request.url).toBe('https://api.example.test/workflows/runs');
    expect(request.method).toBe('POST');
    expect(requestBody).toEqual(body);
  });
});
