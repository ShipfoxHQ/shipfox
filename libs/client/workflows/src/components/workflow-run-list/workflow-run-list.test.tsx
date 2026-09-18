import {configureApiClient} from '@shipfox/client-api';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {screen} from '@testing-library/react';
import {
  workflowRunDto,
  workflowRunListItem,
  workflowRunListResponseDto,
} from '#test/fixtures/workflow-run.js';
import {renderWithRouter} from '#test/render.js';
import {WorkflowRunList} from './workflow-run-list.js';
import {WorkflowRunRow} from './workflow-run-row.js';

const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
describe('WorkflowRunList', () => {
  test('links a parent run once where the actor normally appears', async () => {
    const parentRunId = '77777777-7777-4777-8777-777777777777';
    const run = workflowRunListItem({
      parent_run: {
        id: parentRunId,
        number: 42,
        name: 'release-production',
        project_id: '22222222-2222-4222-8222-222222222222',
      },
    });

    renderWithRouter(<WorkflowRunRow run={run} workspaceSlug="acme" projectSlug="checkout-api" />);

    const parentLink = await screen.findByRole('link', {
      name: 'Started by release-production #42',
    });
    expect(parentLink).toHaveAttribute('href', `/w/acme/p/checkout-api/runs/${parentRunId}`);
    expect(screen.getAllByText('Started by release-production #42')).toHaveLength(1);
  });

  test('resolves a parent link in another project', async () => {
    const parentRunId = '77777777-7777-4777-8777-777777777777';
    const parentProjectId = '99999999-9999-4999-8999-999999999999';
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(async () =>
        jsonResponse({
          id: parentProjectId,
          workspace_id: '88888888-8888-4888-8888-888888888888',
          name: 'Platform',
          slug: 'platform',
          source: {
            connection_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            external_repository_id: 'platform-repo',
          },
          created_at: '2026-05-07T00:00:00.000Z',
          updated_at: '2026-05-07T00:00:00.000Z',
        }),
      ),
    });
    const run = workflowRunListItem({
      parent_run: {
        id: parentRunId,
        number: 42,
        name: 'release-production',
        project_id: parentProjectId,
      },
    });

    const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
    renderWithRouter(
      <QueryClientProvider client={queryClient}>
        <WorkflowRunRow run={run} workspaceSlug="acme" projectSlug="checkout-api" />
      </QueryClientProvider>,
    );

    const parentLink = await screen.findByRole('link', {
      name: 'Started by release-production #42',
    });
    expect(parentLink).toHaveAttribute('href', `/w/acme/p/platform/runs/${parentRunId}`);
  });

  test('defaults to synced runs and exposes the run scope filter', async () => {
    const syncedRun = workflowRunDto({
      id: '66666666-6666-4666-8666-000000000001',
      name: 'deploy-web',
    });
    const devRun = workflowRunDto({
      id: '66666666-6666-4666-8666-000000000002',
      name: 'triage-sentry',
      origin: 'dev',
      dev_source: {
        ref: 'fix-triage-prompt',
        commit: 'abcdef1234567890abcdef1234567890abcdef12',
        definition_source: 'ref',
        config_path: '.shipfox/workflows/triage-sentry.yml',
        initiated_by_user_id: '99999999-9999-4999-8999-999999999999',
        replay_of_event_id: null,
      },
    });
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      expect(new URL(requestInputUrl(input)).searchParams.get('origin')).toBe('synced');
      return Promise.resolve(
        jsonResponse(
          workflowRunListResponseDto({
            runs: [syncedRun, devRun],
            filtered_total_count: 2,
          }),
        ),
      );
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
    renderWithRouter(
      <QueryClientProvider client={queryClient}>
        <WorkflowRunList projectId={PROJECT_ID} workspaceSlug="acme" projectSlug="checkout-api" />
      </QueryClientProvider>,
    );

    await screen.findByText('deploy-web');
    expect(screen.queryByText('triage-sentry')).not.toBeInTheDocument();
    expect(
      fetchImpl.mock.calls.every(
        ([input]) => new URL(requestInputUrl(input)).searchParams.get('origin') === 'synced',
      ),
    ).toBe(true);
    expect(screen.getByRole('combobox', {name: 'Filter runs by type'})).toHaveTextContent(
      'Synced runs',
    );
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
  });
}

function requestInputUrl(input: RequestInfo | URL): string {
  if (input instanceof Request) return input.url;
  return String(input);
}
