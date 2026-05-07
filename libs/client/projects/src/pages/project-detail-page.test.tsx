import {configureApiClient} from '@shipfox/client-api';
import {fireEvent, screen, waitFor} from '@testing-library/react';
import {jsonResponse, PROJECT_TEST_WID, renderProjectPage} from '#test/pages.js';
import {ProjectDetailPage} from './project-detail-page.js';

const PROJECT_ID = '44444444-4444-4444-8444-444444444444';

describe('ProjectDetailPage', () => {
  test('renders workflow definitions and source metadata', async () => {
    configureApiClient({fetchImpl: createProjectDetailFetch()});

    renderProjectPage(
      `/workspaces/${PROJECT_TEST_WID}/projects/${PROJECT_ID}`,
      <ProjectDetailPage projectId={PROJECT_ID} />,
    );

    expect(await screen.findByRole('heading', {name: 'Workflows'})).toBeInTheDocument();
    expect(screen.getAllByText('Deploy production')[0]).toBeInTheDocument();
    expect(screen.getAllByText('.shipfox/workflows/deploy.yml')[0]).toBeInTheDocument();
    expect(screen.getAllByText('succeeded')[0]).toBeInTheDocument();
    expect(screen.getByRole('heading', {name: 'Source identity'})).toBeInTheDocument();
    expect(screen.getAllByText('platform')[0]).toBeInTheDocument();
  });

  test('shows definitions error while keeping source metadata visible', async () => {
    configureApiClient({
      fetchImpl: createProjectDetailFetch({
        definitions: jsonResponse({code: 'server-error'}, {status: 500}),
      }),
    });

    renderProjectPage(
      `/workspaces/${PROJECT_TEST_WID}/projects/${PROJECT_ID}`,
      <ProjectDetailPage projectId={PROJECT_ID} />,
    );

    expect(await screen.findByText('Workflows unavailable')).toBeInTheDocument();
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.queryByText('No sync')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', {name: 'Source identity'})).toBeInTheDocument();
  });

  test('shows failed sync empty state', async () => {
    configureApiClient({
      fetchImpl: createProjectDetailFetch({
        definitions: jsonResponse(
          definitionsDto({
            definitions: [],
            sync: {
              ref: 'main',
              status: 'failed',
              last_sync_at: '2026-05-07T01:00:00.000Z',
              started_at: '2026-05-07T01:00:00.000Z',
              finished_at: null,
              last_error_code: 'no-workflow-files',
              last_error_message: 'No workflow files found',
            },
          }),
        ),
      }),
    });

    renderProjectPage(
      `/workspaces/${PROJECT_TEST_WID}/projects/${PROJECT_ID}`,
      <ProjectDetailPage projectId={PROJECT_ID} />,
    );

    expect(
      await screen.findByText('No workflow files found under .shipfox/workflows/.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Workflow sync failed')).toBeInTheDocument();
  });

  test('opens and closes the definition drawer', async () => {
    configureApiClient({fetchImpl: createProjectDetailFetch()});

    renderProjectPage(
      `/workspaces/${PROJECT_TEST_WID}/projects/${PROJECT_ID}`,
      <ProjectDetailPage projectId={PROJECT_ID} />,
    );

    const [detailsButton] = await screen.findAllByRole('button', {name: 'Details'});
    if (!detailsButton) throw new Error('Details button was not rendered');

    fireEvent.click(detailsButton);

    expect(await screen.findByText('Normalized definition')).toBeInTheDocument();
    expect(screen.getByText((content) => content.includes('"deploy"'))).toBeInTheDocument();

    fireEvent.keyDown(document, {key: 'Escape'});

    await waitFor(() => {
      expect(screen.queryByText('Normalized definition')).not.toBeInTheDocument();
    });
  });

  test('Run posts project_id and definition_id', async () => {
    const requests: RecordedRequest[] = [];
    const fetchImpl = createProjectDetailFetch({requests});
    configureApiClient({fetchImpl});

    renderProjectPage(
      `/workspaces/${PROJECT_TEST_WID}/projects/${PROJECT_ID}`,
      <ProjectDetailPage projectId={PROJECT_ID} />,
    );

    const [runButton] = await screen.findAllByRole('button', {name: 'Run'});
    if (!runButton) throw new Error('Run button was not rendered');

    fireEvent.click(runButton);

    await waitFor(() => {
      expect(requests).toContainEqual({
        url: 'https://api.example.test/workflows/runs',
        method: 'POST',
        body: JSON.stringify({
          project_id: PROJECT_ID,
          definition_id: '55555555-5555-4555-8555-555555555555',
        }),
      });
    });
  });

  test('renders not found state', async () => {
    configureApiClient({
      fetchImpl: vi.fn((input) => {
        const url = new URL(requestInputUrl(input));
        if (url.pathname === `/projects/${PROJECT_ID}`) {
          return Promise.resolve(jsonResponse({code: 'not-found'}, {status: 404}));
        }
        return Promise.resolve(jsonResponse(definitionsDto()));
      }),
    });

    renderProjectPage(
      `/workspaces/${PROJECT_TEST_WID}/projects/${PROJECT_ID}`,
      <ProjectDetailPage projectId={PROJECT_ID} />,
    );

    expect(await screen.findByText('This project was not found.')).toBeInTheDocument();
  });
});

interface RecordedRequest {
  url: string;
  method: string;
  body: string | undefined;
}

function createProjectDetailFetch({
  project = jsonResponse(projectDto()),
  definitions = jsonResponse(definitionsDto()),
  run = jsonResponse(runDto(), {status: 201}),
  requests,
}: {
  project?: Response;
  definitions?: Response;
  run?: Response;
  requests?: RecordedRequest[];
} = {}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(requestInputUrl(input));
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const body =
      typeof init?.body === 'string'
        ? init.body
        : input instanceof Request
          ? await input.clone().text()
          : undefined;

    requests?.push({url: url.toString(), method, body});

    if (url.pathname === `/projects/${PROJECT_ID}`) {
      return Promise.resolve(project.clone());
    }
    if (url.pathname === '/definitions') {
      return Promise.resolve(definitions.clone());
    }
    if (url.pathname === '/workflows/runs' && init?.method === 'POST') {
      return Promise.resolve(run.clone());
    }
    return Promise.resolve(jsonResponse({code: 'not-found'}, {status: 404}));
  });
}

function requestInputUrl(input: RequestInfo | URL) {
  if (input instanceof Request) return input.url;
  return String(input);
}

function projectDto() {
  return {
    id: PROJECT_ID,
    workspace_id: '11111111-1111-4111-8111-111111111111',
    name: 'Platform',
    source: {
      connection_id: '33333333-3333-4333-8333-333333333333',
      external_repository_id: 'platform',
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function definitionsDto(overrides: Partial<{definitions: unknown[]; sync: unknown}> = {}) {
  return {...baseDefinitionsDto(), ...overrides};
}

function baseDefinitionsDto() {
  return {
    definitions: [
      {
        id: '55555555-5555-4555-8555-555555555555',
        project_id: PROJECT_ID,
        config_path: '.shipfox/workflows/deploy.yml',
        source: 'vcs',
        sha: 'abc123',
        ref: 'main',
        name: 'Deploy production',
        definition: {
          name: 'Deploy production',
          jobs: {deploy: {steps: [{run: './deploy.sh'}]}},
        },
        fetched_at: '2026-05-07T01:00:00.000Z',
        created_at: '2026-05-07T01:00:00.000Z',
        updated_at: '2026-05-07T01:00:00.000Z',
      },
    ],
    sync: {
      ref: 'main',
      status: 'succeeded',
      last_sync_at: '2026-05-07T01:00:00.000Z',
      started_at: '2026-05-07T00:59:55.000Z',
      finished_at: '2026-05-07T01:00:00.000Z',
      last_error_code: null,
      last_error_message: null,
    },
  };
}

function runDto() {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    project_id: PROJECT_ID,
    definition_id: '55555555-5555-4555-8555-555555555555',
    status: 'pending',
    trigger_context: {type: 'manual'},
    inputs: null,
    created_at: '2026-05-07T01:01:00.000Z',
    updated_at: '2026-05-07T01:01:00.000Z',
  };
}
