import {configureApiClient} from '@shipfox/client-api';
import {fireEvent, screen, waitFor, within} from '@testing-library/react';
import {jsonResponse, renderProjectPage} from '#test/pages.js';
import {ProjectSettingsPage} from './project-settings-page.js';

const NO_OTHER_AGENT_CLAIMS_RE = /no other agent claims/u;
const DELETE_PLATFORM_RE = /Delete Platform/u;
const TYPE_PLATFORM_RE = /Type Platform to confirm/u;

describe('ProjectSettingsPage', () => {
  test('saves a name change without opening the slug warning', async () => {
    let patchBody: unknown;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.method === 'PATCH') {
        patchBody = await request.clone().json();
        return jsonResponse(projectDto({name: 'Platform API'}));
      }
      return jsonResponse({projects: [projectDto()], next_cursor: null});
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderProjectPage('/w/acme/p/platform/settings/general', <ProjectSettingsPage />);
    const nameInput = await screen.findByLabelText('Project name');
    expect(screen.getByRole('heading', {name: 'General'})).toBeInTheDocument();
    const settingsForm = nameInput.closest('form');
    expect(settingsForm).not.toBeNull();
    expect(settingsForm).toHaveClass('max-w-[560px]');
    expect(
      screen.queryByText('Update the project name and the slug used in its URLs.'),
    ).not.toBeInTheDocument();
    expect(document.querySelectorAll('[data-slot="panel"]')).toHaveLength(2);
    fireEvent.change(nameInput, {
      target: {value: 'Platform API'},
    });
    fireEvent.click(screen.getByRole('button', {name: 'Save changes'}));

    await waitFor(() => expect(patchBody).toEqual({name: 'Platform API'}));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('explains what the default project is for, and not for another project', async () => {
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(async () =>
        jsonResponse({projects: [projectDto({isDefault: true})], next_cursor: null}),
      ),
    });

    renderProjectPage('/w/acme/p/platform/settings/general', <ProjectSettingsPage />);

    expect(await screen.findByLabelText('Project name')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Shippy in this project answers Slack and Linear requests that no other agent claims.',
      ),
    ).toBeVisible();
  });

  test('says nothing about the default on another project', async () => {
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(async () => jsonResponse({projects: [projectDto()], next_cursor: null})),
    });

    renderProjectPage('/w/acme/p/platform/settings/general', <ProjectSettingsPage />);

    expect(await screen.findByLabelText('Project name')).toBeInTheDocument();
    expect(screen.queryByText(NO_OTHER_AGENT_CLAIMS_RE)).not.toBeInTheDocument();
  });

  test('requires confirmation before saving a slug change', async () => {
    let patchBody: unknown;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.method === 'PATCH') {
        patchBody = await request.clone().json();
        return jsonResponse(projectDto({slug: 'platform-api'}));
      }
      return jsonResponse({projects: [projectDto()], next_cursor: null});
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderProjectPage('/w/acme/p/platform/settings/general', <ProjectSettingsPage />);
    fireEvent.change(await screen.findByLabelText('Project slug'), {
      target: {value: 'platform-api'},
    });
    fireEvent.click(screen.getByRole('button', {name: 'Save changes'}));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('old URL stop working');
    expect(
      fetchImpl.mock.calls.some(([input]) =>
        (input as Request).url.includes('/projects/slug-availability'),
      ),
    ).toBe(false);
    expect(patchBody).toBeUndefined();

    fireEvent.click(screen.getByRole('button', {name: 'Change slug'}));
    await waitFor(() => expect(patchBody).toEqual({slug: 'platform-api'}));
  });

  test('hides the delete section on the default project', async () => {
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(async () =>
        jsonResponse({projects: [projectDto({isDefault: true})], next_cursor: null}),
      ),
    });

    renderProjectPage('/w/acme/p/platform/settings/general', <ProjectSettingsPage />);

    expect(await screen.findByLabelText('Project name')).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Delete project'})).not.toBeInTheDocument();
  });

  test('deletes the project once its name is typed, then opens the workspace home', async () => {
    let deleteRequest: {url: string; body: unknown} | undefined;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.method === 'DELETE') {
        deleteRequest = {url: request.url, body: await request.clone().json()};
        return new Response(null, {status: 204});
      }
      if (deleteRequest) return jsonResponse({projects: [], next_cursor: null});
      return jsonResponse({projects: [projectDto()], next_cursor: null});
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderProjectPage('/w/acme/p/platform/settings/general', <ProjectSettingsPage />);
    fireEvent.click(await screen.findByRole('button', {name: 'Delete project'}));

    const dialog = await screen.findByRole('dialog', {name: DELETE_PLATFORM_RE});
    const confirm = within(dialog).getByRole('button', {name: 'Delete project'});
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(TYPE_PLATFORM_RE), {
      target: {value: 'platform'},
    });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(TYPE_PLATFORM_RE), {
      target: {value: 'Platform'},
    });
    fireEvent.click(confirm);

    expect(await screen.findByLabelText('Search projects')).toBeInTheDocument();
    expect(deleteRequest).toEqual({
      url: 'https://api.example.test/projects/44444444-4444-4444-8444-444444444444',
      body: {name: 'Platform'},
    });
  });

  test('keeps the dialog open with the reason when the API refuses the deletion', async () => {
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.method === 'DELETE') {
        return Promise.resolve(
          jsonResponse(
            {code: 'forbidden', message: 'Workspace admin role required'},
            {status: 403},
          ),
        );
      }
      return Promise.resolve(jsonResponse({projects: [projectDto()], next_cursor: null}));
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderProjectPage('/w/acme/p/platform/settings/general', <ProjectSettingsPage />);
    fireEvent.click(await screen.findByRole('button', {name: 'Delete project'}));
    const dialog = await screen.findByRole('dialog', {name: DELETE_PLATFORM_RE});
    fireEvent.change(within(dialog).getByLabelText(TYPE_PLATFORM_RE), {
      target: {value: 'Platform'},
    });
    fireEvent.click(within(dialog).getByRole('button', {name: 'Delete project'}));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Only workspace admins can delete this project.',
    );
  });
});

function projectDto({
  name = 'Platform',
  slug = 'platform',
  isDefault = false,
}: {
  name?: string;
  slug?: string;
  isDefault?: boolean;
} = {}) {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    workspace_id: '11111111-1111-4111-8111-111111111111',
    name,
    slug,
    is_default: isDefault,
    source: {
      kind: 'linked',
      connection_id: '33333333-3333-4333-8333-333333333333',
      external_repository_id: 'platform',
    },
    created_at: '2026-05-07T01:00:00.000Z',
    updated_at: '2026-05-07T01:00:00.000Z',
  };
}
