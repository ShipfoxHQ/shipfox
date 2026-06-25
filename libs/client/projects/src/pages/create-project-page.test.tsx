import {configureApiClient} from '@shipfox/client-api';
import {fireEvent, screen, waitFor} from '@testing-library/react';
import {jsonResponse, PROJECT_TEST_WID, renderProjectPage} from '#test/pages.js';
import {CreateProjectPage} from './create-project-page.js';

const CONNECTION_ID = '33333333-3333-4333-8333-333333333333';
const SECOND_CONNECTION_ID = '66666666-6666-4666-8666-666666666666';
const REPOSITORY_NOT_FOUND_RE = /Repository not found/;
const DEBUG_RADIO_LABEL_RE = /^Debug debug · debug$/;

describe('CreateProjectPage', () => {
  test('with a single connection: pre-selects, renders repos, creates a project', async () => {
    let createProjectBody: unknown;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.url.includes('/integration-connections?')) {
        return jsonResponse({connections: [connectionDto()]});
      }
      if (request.url.includes(`/integration-connections/${CONNECTION_ID}/repositories`)) {
        return jsonResponse({repositories: [repositoryDto()], next_cursor: null});
      }
      if (request.url.endsWith('/projects') && request.method === 'POST') {
        createProjectBody = await request.json();
        return jsonResponse(projectDto({id: '44444444-4444-4444-8444-444444444444'}));
      }
      return jsonResponse(projectDto({id: '44444444-4444-4444-8444-444444444444'}));
    });
    configureApiClient({fetchImpl});

    renderProjectPage(`/workspaces/${PROJECT_TEST_WID}/projects/new`, <CreateProjectPage />);
    expect(await screen.findByRole('radio', {name: DEBUG_RADIO_LABEL_RE})).toBeChecked();
    expect((await screen.findAllByText('Debug')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('debug-owner/platform')).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByLabelText('Project name')).toHaveValue('Platform'));
    fireEvent.change(screen.getByLabelText('Project name'), {
      target: {value: '  Launch Pad  '},
    });
    fireEvent.click(screen.getByRole('button', {name: 'Create project'}));

    expect(await screen.findByRole('heading', {name: 'Runs'})).toBeInTheDocument();
    expect(createProjectBody).toEqual({
      workspace_id: PROJECT_TEST_WID,
      name: 'Launch Pad',
      source: {
        connection_id: CONNECTION_ID,
        external_repository_id: 'platform',
      },
    });
  });

  test('uses the current repository-derived name when submitted before touching the field', async () => {
    let createProjectBody: unknown;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.url.includes('/integration-connections?')) {
        return jsonResponse({connections: [connectionDto()]});
      }
      if (request.url.includes(`/integration-connections/${CONNECTION_ID}/repositories`)) {
        return jsonResponse({repositories: [repositoryDto()], next_cursor: null});
      }
      if (request.url.endsWith('/projects') && request.method === 'POST') {
        createProjectBody = await request.json();
        return jsonResponse(projectDto({id: '44444444-4444-4444-8444-444444444444'}));
      }
      return jsonResponse(projectDto({id: '44444444-4444-4444-8444-444444444444'}));
    });
    configureApiClient({fetchImpl});

    renderProjectPage(`/workspaces/${PROJECT_TEST_WID}/projects/new`, <CreateProjectPage />);
    expect((await screen.findAllByText('debug-owner/platform')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', {name: 'Create project'}));

    expect(await screen.findByRole('heading', {name: 'Runs'})).toBeInTheDocument();
    expect(createProjectBody).toEqual({
      workspace_id: PROJECT_TEST_WID,
      name: 'Platform',
      source: {
        connection_id: CONNECTION_ID,
        external_repository_id: 'platform',
      },
    });
  });

  test('with multiple connections: hides repo picker until a connection is selected', async () => {
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.url.includes('/integration-connections?')) {
        return Promise.resolve(
          jsonResponse({connections: [connectionDto(), secondConnectionDto()]}),
        );
      }
      if (request.url.includes(`/integration-connections/${CONNECTION_ID}/repositories`)) {
        return Promise.resolve(jsonResponse({repositories: [repositoryDto()], next_cursor: null}));
      }
      return Promise.resolve(jsonResponse({}));
    });
    configureApiClient({fetchImpl});

    renderProjectPage(`/workspaces/${PROJECT_TEST_WID}/projects/new`, <CreateProjectPage />);
    expect((await screen.findAllByText('Debug')).length).toBeGreaterThan(0);
    expect(await screen.findByText('Other Debug Source')).toBeInTheDocument();
    expect(screen.queryByText('debug-owner/platform')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', {name: DEBUG_RADIO_LABEL_RE}));

    expect((await screen.findAllByText('debug-owner/platform')).length).toBeGreaterThan(0);
  });

  test('rejects invalid custom project names locally', async () => {
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.url.includes('/integration-connections?')) {
        return Promise.resolve(jsonResponse({connections: [connectionDto()]}));
      }
      if (request.url.includes(`/integration-connections/${CONNECTION_ID}/repositories`)) {
        return Promise.resolve(jsonResponse({repositories: [repositoryDto()], next_cursor: null}));
      }
      return Promise.resolve(jsonResponse({}));
    });
    configureApiClient({fetchImpl});

    renderProjectPage(`/workspaces/${PROJECT_TEST_WID}/projects/new`, <CreateProjectPage />);
    expect((await screen.findAllByText('debug-owner/platform')).length).toBeGreaterThan(0);
    fireEvent.change(await screen.findByLabelText('Project name'), {
      target: {value: 'Bad\u202eName'},
    });
    fireEvent.click(screen.getByRole('button', {name: 'Create project'}));

    expect(
      await screen.findByText(
        'Project name cannot include line breaks, tabs, or hidden formatting characters.',
      ),
    ).toBeInTheDocument();
    expect(projectPostCount(fetchImpl)).toBe(0);
  });

  test('with a single connection: shows workspace-scoped "Add another integration" link', async () => {
    configureApiClient({
      fetchImpl: vi.fn((input: RequestInfo | URL) => {
        const request = input as Request;
        if (request.url.includes('/integration-connections?')) {
          return Promise.resolve(jsonResponse({connections: [connectionDto()]}));
        }
        if (request.url.includes(`/integration-connections/${CONNECTION_ID}/repositories`)) {
          return Promise.resolve(
            jsonResponse({repositories: [repositoryDto()], next_cursor: null}),
          );
        }
        return Promise.resolve(jsonResponse({}));
      }),
    });

    renderProjectPage(`/workspaces/${PROJECT_TEST_WID}/projects/new`, <CreateProjectPage />);
    const link = await screen.findByRole('link', {name: 'Add another integration'});
    expect(link).toHaveAttribute('href', `/workspaces/${PROJECT_TEST_WID}/integrations`);
  });

  test('navigates to the existing project for duplicate recovery', async () => {
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.url.includes('/integration-connections?')) {
        return Promise.resolve(jsonResponse({connections: [connectionDto()]}));
      }
      if (request.url.includes(`/integration-connections/${CONNECTION_ID}/repositories`)) {
        return Promise.resolve(jsonResponse({repositories: [repositoryDto()], next_cursor: null}));
      }
      if (request.url.endsWith('/projects')) {
        return Promise.resolve(
          jsonResponse(
            {
              code: 'project-already-exists',
              details: {existing_project_id: '55555555-5555-4555-8555-555555555555'},
            },
            {status: 409},
          ),
        );
      }
      if (request.url.includes('/projects?')) {
        return Promise.resolve(
          jsonResponse({
            projects: [projectDto({id: '55555555-5555-4555-8555-555555555555'})],
            next_cursor: null,
          }),
        );
      }
      if (request.url.includes('/definitions?')) {
        return Promise.resolve(jsonResponse({definitions: [], next_cursor: null, sync: null}));
      }
      return Promise.resolve(
        jsonResponse(projectDto({id: '55555555-5555-4555-8555-555555555555'})),
      );
    });
    configureApiClient({fetchImpl});

    renderProjectPage(`/workspaces/${PROJECT_TEST_WID}/projects/new`, <CreateProjectPage />);
    expect((await screen.findAllByText('debug-owner/platform')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', {name: 'Create project'}));

    // After duplicate recovery, navigation lands on the workspace-scoped project
    // URL. Production redirects that URL to the Runs tab.
    expect(await screen.findByRole('heading', {name: 'Runs'})).toBeInTheDocument();
  });

  test('shows provider-specific submit errors', async () => {
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.url.includes('/integration-connections?')) {
        return Promise.resolve(jsonResponse({connections: [connectionDto()]}));
      }
      if (request.url.includes(`/integration-connections/${CONNECTION_ID}/repositories`)) {
        return Promise.resolve(jsonResponse({repositories: [repositoryDto()], next_cursor: null}));
      }
      return Promise.resolve(jsonResponse({code: 'repository-not-found'}, {status: 422}));
    });
    configureApiClient({fetchImpl});

    renderProjectPage(`/workspaces/${PROJECT_TEST_WID}/projects/new`, <CreateProjectPage />);
    expect((await screen.findAllByText('debug-owner/platform')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', {name: 'Create project'}));

    expect(await screen.findByText(REPOSITORY_NOT_FOUND_RE)).toBeInTheDocument();
  });
});

function connectionDto() {
  return {
    id: CONNECTION_ID,
    workspace_id: '11111111-1111-4111-8111-111111111111',
    provider: 'debug',
    external_account_id: 'debug',
    display_name: 'Debug',
    lifecycle_status: 'active',
    capabilities: ['source_control'],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function secondConnectionDto() {
  return {
    id: SECOND_CONNECTION_ID,
    workspace_id: '11111111-1111-4111-8111-111111111111',
    provider: 'debug',
    external_account_id: 'debug-2',
    display_name: 'Other Debug Source',
    lifecycle_status: 'active',
    capabilities: ['source_control'],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function repositoryDto() {
  return {
    connection_id: CONNECTION_ID,
    external_repository_id: 'platform',
    owner: 'debug-owner',
    name: 'platform',
    full_name: 'debug-owner/platform',
    default_branch: 'main',
    visibility: 'private',
    clone_url: 'https://debug.local/debug-owner/platform.git',
    html_url: 'https://debug.local/debug-owner/platform',
  };
}

function projectDto({id}: {id: string}) {
  return {
    id,
    workspace_id: '11111111-1111-4111-8111-111111111111',
    name: 'Project Detail',
    source: {
      connection_id: CONNECTION_ID,
      external_repository_id: 'platform',
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function projectPostCount(fetchImpl: ReturnType<typeof vi.fn>): number {
  return fetchImpl.mock.calls.filter(([input]) => {
    const request = input as Request;
    return request.url.endsWith('/projects') && request.method === 'POST';
  }).length;
}
