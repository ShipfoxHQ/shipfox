import {configureApiClient} from '@shipfox/client-api';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {cleanup, renderHook, waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
import {listRunReadiness, useRunReadinessQuery} from './run-readiness.js';

type FetchMock = typeof fetch & {mock: {calls: unknown[][]}};

const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const FIRST_ID = '55555555-5555-4555-8555-555555555555';
const SECOND_ID = '66666666-6666-4666-8666-666666666666';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: {'content-type': 'application/json'},
    status,
  });
}

function readinessBody(definitionId = FIRST_ID) {
  return {
    definitions: [
      {
        definition_id: definitionId,
        issues: [
          {
            kind: 'variable-missing',
            key: 'E2E_SCHEDULE_ENABLED',
            locations: [{job_key: 'e2e', field: 'job.if'}],
            more_locations: 2,
            effect: 'blocks-start',
          },
        ],
      },
    ],
  };
}

function requestUrl(fetchImpl: FetchMock, call: number) {
  return new URL((fetchImpl.mock.calls[call]?.[0] as Request).url);
}

afterEach(() => {
  cleanup();
  configureApiClient({baseUrl: '', fetchImpl: undefined});
});

describe('listRunReadiness', () => {
  test('requests the definitions and maps the issues to the client model', async () => {
    const fetchImpl = vi.fn((_input: RequestInfo | URL) =>
      Promise.resolve(jsonResponse(readinessBody())),
    );
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const readiness = await listRunReadiness({
      projectId: PROJECT_ID,
      definitionIds: [FIRST_ID, SECOND_ID],
    });

    const url = requestUrl(fetchImpl, 0);
    expect(url.pathname).toBe('/workflow-definitions/readiness');
    expect(url.searchParams.get('project_id')).toBe(PROJECT_ID);
    expect(url.searchParams.getAll('definition_id')).toEqual([FIRST_ID, SECOND_ID]);
    expect(readiness.get(FIRST_ID)).toEqual([
      {
        kind: 'variable-missing',
        key: 'E2E_SCHEDULE_ENABLED',
        locations: [{field: 'job.if', jobKey: 'e2e'}],
        moreLocations: 2,
        effect: 'blocks-start',
      },
    ]);
  });
});

describe('listRunReadiness issue kinds', () => {
  test('maps agent and trigger-scoped issues', async () => {
    const trigger = {source: 'cron', name: 'nightly'};
    const fetchImpl = vi.fn((_input: RequestInfo | URL) =>
      Promise.resolve(
        jsonResponse({
          definitions: [
            {
              definition_id: FIRST_ID,
              issues: [
                {
                  kind: 'agent-config-invalid',
                  reason: 'model-unknown',
                  model: 'gpt-x',
                  locations: [{job_key: 'review', field: 'agent.model'}],
                  effect: 'blocks-start',
                },
                {kind: 'trigger-secret-missing', key: 'TOKEN', trigger, effect: 'blocks-start'},
                {
                  kind: 'secret-input-unmapped',
                  key: 'TOKEN',
                  trigger,
                  locations: [{job_key: 'deploy', field: 'env', env_key: 'TOKEN'}],
                  effect: 'fails-job',
                },
              ],
            },
          ],
        }),
      ),
    );
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const readiness = await listRunReadiness({projectId: PROJECT_ID, definitionIds: [FIRST_ID]});

    expect(readiness.get(FIRST_ID)).toEqual([
      {
        kind: 'agent-config-invalid',
        model: 'gpt-x',
        locations: [{field: 'agent.model', jobKey: 'review'}],
        effect: 'blocks-start',
      },
      {kind: 'trigger-secret-missing', key: 'TOKEN', trigger},
      {
        kind: 'secret-input-unmapped',
        key: 'TOKEN',
        trigger,
        locations: [{field: 'env', jobKey: 'deploy', envKey: 'TOKEN'}],
      },
    ]);
  });
});

describe('useRunReadinessQuery', () => {
  function setup(fetchImpl: FetchMock) {
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
    const wrapper = ({children}: {children: ReactNode}) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    return {queryClient, wrapper};
  }

  test('requests each loaded page of definitions separately', async () => {
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = new URL((input as Request).url);
      return Promise.resolve(
        jsonResponse(readinessBody(url.searchParams.get('definition_id') ?? FIRST_ID)),
      );
    });
    const {wrapper} = setup(fetchImpl);

    const {result} = renderHook(() => useRunReadinessQuery(PROJECT_ID, [[FIRST_ID], [SECOND_ID]]), {
      wrapper,
    });

    await waitFor(() => expect([...result.current.keys()].sort()).toEqual([FIRST_ID, SECOND_ID]));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('refetches on every mount, so returning from settings refreshes the tag', async () => {
    const fetchImpl = vi.fn((_input: RequestInfo | URL) =>
      Promise.resolve(jsonResponse(readinessBody())),
    );
    const {wrapper} = setup(fetchImpl);

    const first = renderHook(() => useRunReadinessQuery(PROJECT_ID, [[FIRST_ID]]), {wrapper});
    await waitFor(() => expect(first.result.current.size).toBe(1));
    first.unmount();

    const second = renderHook(() => useRunReadinessQuery(PROJECT_ID, [[FIRST_ID]]), {wrapper});
    expect(second.result.current.size).toBe(1);
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
  });

  test('stays empty when the request fails', async () => {
    const fetchImpl = vi.fn((_input: RequestInfo | URL) =>
      Promise.resolve(jsonResponse({code: 'server-error'}, 500)),
    );
    const {wrapper} = setup(fetchImpl);

    const {result} = renderHook(() => useRunReadinessQuery(PROJECT_ID, [[FIRST_ID]]), {wrapper});

    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    expect(result.current.size).toBe(0);
  });

  test('does not request anything without definitions', () => {
    const fetchImpl = vi.fn((_input: RequestInfo | URL) =>
      Promise.resolve(jsonResponse(readinessBody())),
    );
    const {wrapper} = setup(fetchImpl);

    renderHook(() => useRunReadinessQuery(PROJECT_ID, []), {wrapper});

    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
