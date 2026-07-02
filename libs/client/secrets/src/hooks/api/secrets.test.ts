import {SECRETS_MAX_LIST_LIMIT} from '@shipfox/api-secrets-dto';
import {configureApiClient} from '@shipfox/client-api';
import {
  SECRETS_TEST_WORKSPACE_ID,
  secret,
  secretsListResponse,
  variable,
  variablesListResponse,
} from '#test/fixtures/secrets.js';
import {deleteSecret, listSecrets, putSecret} from './secrets.js';
import {deleteVariable, listVariables, putVariable} from './variables.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {'content-type': 'application/json'},
    status: 200,
    ...init,
  });
}

describe('store transport', () => {
  beforeEach(() => {
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl: undefined});
  });

  test('lists the whole secret set in a single call at the max limit', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(secretsListResponse()));
    configureApiClient({fetchImpl});

    const result = await listSecrets({workspaceId: SECRETS_TEST_WORKSPACE_ID});

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result).toEqual([secret()]);
    expect(request.method).toBe('GET');
    expect(request.url).toBe(
      `https://api.example.test/workspaces/${SECRETS_TEST_WORKSPACE_ID}/secrets?limit=${SECRETS_MAX_LIST_LIMIT}`,
    );
  });

  test('returns an empty array when the store is empty', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(secretsListResponse({secrets: [], next_cursor: null})));
    configureApiClient({fetchImpl});

    const result = await listSecrets({workspaceId: SECRETS_TEST_WORKSPACE_ID});

    expect(result).toEqual([]);
  });

  test('puts a secret, encodes the key, and passes warnings through', async () => {
    let requestBody: unknown;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      requestBody = await (input as Request).clone().json();
      return jsonResponse({
        secret: secret({key: 'MY_TOKEN'}),
        warnings: [{code: 'short-secret-value', key: 'MY_TOKEN'}],
      });
    });
    configureApiClient({fetchImpl});

    const result = await putSecret({
      workspaceId: SECRETS_TEST_WORKSPACE_ID,
      key: 'MY_TOKEN',
      body: {value: 'short'},
    });

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(request.method).toBe('PUT');
    expect(request.url).toBe(
      `https://api.example.test/workspaces/${SECRETS_TEST_WORKSPACE_ID}/secrets/MY_TOKEN`,
    );
    expect(requestBody).toEqual({value: 'short'});
    expect(result.warnings).toEqual([{code: 'short-secret-value', key: 'MY_TOKEN'}]);
    expect(result.item.key).toBe('MY_TOKEN');
  });

  test('deletes a secret with a 204 and no project scope by default', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, {status: 204}));
    configureApiClient({fetchImpl});

    const result = await deleteSecret({workspaceId: SECRETS_TEST_WORKSPACE_ID, key: 'MY_TOKEN'});

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(result).toBeUndefined();
    expect(request.method).toBe('DELETE');
    expect(request.url).toBe(
      `https://api.example.test/workspaces/${SECRETS_TEST_WORKSPACE_ID}/secrets/MY_TOKEN`,
    );
  });

  test('lists variables (values included) via the same factory', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(variablesListResponse()));
    configureApiClient({fetchImpl});

    const result = await listVariables({workspaceId: SECRETS_TEST_WORKSPACE_ID});

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(result).toEqual([variable()]);
    expect(request.url).toBe(
      `https://api.example.test/workspaces/${SECRETS_TEST_WORKSPACE_ID}/variables?limit=${SECRETS_MAX_LIST_LIMIT}`,
    );
  });

  test('puts a variable and returns the sensitive-name warning', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        variable: variable({key: 'MY_KEY', value: 'v'}),
        warnings: [{code: 'sensitive-variable-name', key: 'MY_KEY'}],
      }),
    );
    configureApiClient({fetchImpl});

    const result = await putVariable({
      workspaceId: SECRETS_TEST_WORKSPACE_ID,
      key: 'MY_KEY',
      body: {value: 'v'},
    });

    expect(result.warnings).toEqual([{code: 'sensitive-variable-name', key: 'MY_KEY'}]);
    expect(result.item.value).toBe('v');
  });

  test('deletes a variable within a project scope via project_id query', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, {status: 204}));
    configureApiClient({fetchImpl});

    await deleteVariable({
      workspaceId: SECRETS_TEST_WORKSPACE_ID,
      key: 'LOG_LEVEL',
      projectId: '33333333-3333-4333-8333-333333333333',
    });

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(request.url).toBe(
      `https://api.example.test/workspaces/${SECRETS_TEST_WORKSPACE_ID}/variables/LOG_LEVEL?project_id=33333333-3333-4333-8333-333333333333`,
    );
  });
});
