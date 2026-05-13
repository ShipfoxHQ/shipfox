import {configureApiClient} from '@shipfox/client-api';
import {fireEvent, screen} from '@testing-library/react';
import {jsonResponse, PROJECT_TEST_WID, renderProjectPage} from '#test/pages.js';
import {ProjectRunsPage} from './project-runs-page.js';

const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const DEFINITION_ID = '55555555-5555-4555-8555-555555555555';
const REFRESH_BUTTON_RE = /refresh/i;

describe('ProjectRunsPage', () => {
  test('renders run history, counts, and paginated load more', async () => {
    configureApiClient({fetchImpl: createRunsFetch()});

    renderProjectPage(
      `/workspaces/${PROJECT_TEST_WID}/projects/${PROJECT_ID}/runs`,
      <ProjectRunsPage projectId={PROJECT_ID} />,
    );

    expect(await screen.findByRole('heading', {name: 'Runs'})).toBeInTheDocument();
    expect((await screen.findAllByText('Deploy production'))[0]).toBeInTheDocument();
    expect(screen.getByText('Loaded 1 of 2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'Load more'}));

    expect((await screen.findAllByText('Cleanup staging'))[0]).toBeInTheDocument();
    expect(screen.getByText('Loaded 2 of 2')).toBeInTheDocument();
  });

  test('does not render a manual Refresh button (polling is silent)', async () => {
    configureApiClient({fetchImpl: createRunsFetch()});

    renderProjectPage(
      `/workspaces/${PROJECT_TEST_WID}/projects/${PROJECT_ID}/runs`,
      <ProjectRunsPage projectId={PROJECT_ID} />,
    );

    expect(await screen.findByRole('heading', {name: 'Runs'})).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: REFRESH_BUTTON_RE})).not.toBeInTheDocument();
  });

  test('applies URL-backed status filters and shows filtered empty state', async () => {
    configureApiClient({fetchImpl: createRunsFetch()});

    // URL-driven filter state: navigating directly to ?status=failed
    // exercises the same URL ⇄ filter round-trip that the dropdown writes
    // when the user selects an option. Driving the Radix dropdown via
    // fireEvent is unreliable in jsdom; the URL path is the source of
    // truth either way.
    renderProjectPage(
      `/workspaces/${PROJECT_TEST_WID}/projects/${PROJECT_ID}/runs?status=failed`,
      <ProjectRunsPage projectId={PROJECT_ID} />,
    );

    expect(await screen.findByRole('heading', {name: 'Runs'})).toBeInTheDocument();
    expect(await screen.findByText('No matching runs')).toBeInTheDocument();

    // Both the filter bar and the empty state render "Clear filters" when
    // filters are active — clicking either drops the filter and re-shows
    // the data. The empty-state button is the second one in DOM order.
    const [clearFiltersButton] = screen.getAllByRole('button', {name: 'Clear filters'});
    if (!clearFiltersButton) throw new Error('Clear filters button not rendered');
    fireEvent.click(clearFiltersButton);

    expect(await screen.findAllByText('Deploy production')).not.toHaveLength(0);
  });
});

function createRunsFetch() {
  return vi.fn((input: RequestInfo | URL) => {
    const url = new URL(requestInputUrl(input));

    if (url.pathname === '/workflows/runs/aggregates') {
      return Promise.resolve(jsonResponse(aggregatesDto()));
    }
    if (url.pathname === '/workflows/runs') {
      if (url.searchParams.get('status') === 'failed') {
        return Promise.resolve(jsonResponse(runsDto({runs: [], next_cursor: null, total: 0})));
      }
      if (url.searchParams.get('cursor') === 'cursor-2') {
        return Promise.resolve(
          jsonResponse(
            runsDto({
              runs: [runDto({id: '77777777-7777-4777-8777-777777777777', name: 'Cleanup staging'})],
              next_cursor: null,
              total: 2,
            }),
          ),
        );
      }
      return Promise.resolve(jsonResponse(runsDto()));
    }
    if (url.pathname === '/definitions') {
      return Promise.resolve(jsonResponse(definitionsDto()));
    }
    return Promise.resolve(jsonResponse({code: 'not-found'}, {status: 404}));
  });
}

function requestInputUrl(input: RequestInfo | URL) {
  if (input instanceof Request) return input.url;
  return String(input);
}

function runsDto({
  runs = [runDto()],
  next_cursor = 'cursor-2',
  total = 2,
}: {
  runs?: unknown[];
  next_cursor?: string | null;
  total?: number;
} = {}) {
  return {runs, next_cursor, filtered_total_count: total};
}

function runDto(overrides: Partial<{id: string; name: string; status: string}> = {}) {
  return {
    id: overrides.id ?? '66666666-6666-4666-8666-666666666666',
    project_id: PROJECT_ID,
    definition_id: DEFINITION_ID,
    name: overrides.name ?? 'Deploy production',
    status: overrides.status ?? 'running',
    trigger_source: 'manual',
    trigger_context: {},
    inputs: null,
    created_at: '2026-05-07T01:01:00.000Z',
    updated_at: '2026-05-07T01:02:00.000Z',
  };
}

function aggregatesDto() {
  return {
    status: [
      {value: 'pending', count: 0},
      {value: 'running', count: 1},
      {value: 'succeeded', count: 1},
      {value: 'failed', count: 0},
      {value: 'cancelled', count: 0},
    ],
    trigger_source: [{value: 'manual', count: 2}],
    workflow: [{definition_id: DEFINITION_ID, name: 'Deploy production', count: 2}],
  };
}

function definitionsDto() {
  return {
    definitions: [
      {
        id: DEFINITION_ID,
        project_id: PROJECT_ID,
        config_path: '.shipfox/workflows/deploy.yml',
        source: 'vcs',
        sha: 'abc123',
        ref: 'main',
        name: 'Deploy production',
        definition: {name: 'Deploy production', jobs: {deploy: {steps: [{run: './deploy.sh'}]}}},
        fetched_at: '2026-05-07T01:00:00.000Z',
        created_at: '2026-05-07T01:00:00.000Z',
        updated_at: '2026-05-07T01:00:00.000Z',
      },
    ],
    next_cursor: null,
    sync: null,
  };
}
