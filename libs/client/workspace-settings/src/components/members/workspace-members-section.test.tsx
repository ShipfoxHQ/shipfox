import {screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {renderWorkspaceSettingsPage, WORKSPACE_SETTINGS_TEST_WID} from '#test/pages.js';
import {WorkspaceMembersSettingsSection} from './workspace-members-section.js';

const CURRENT_USER_ID = '22222222-2222-4222-8222-222222222222';
const WORKSPACE_ID = WORKSPACE_SETTINGS_TEST_WID;
const NAME_SORT_BUTTON = /Name, not sorted/u;

const members = [
  {
    id: '55555555-5555-4555-8555-555555555551',
    user_id: CURRENT_USER_ID,
    workspace_id: WORKSPACE_ID,
    user_email: 'zara@example.com',
    user_name: 'Zara',
    created_at: '2026-07-03T00:00:00.000Z',
    updated_at: '2026-07-03T00:00:00.000Z',
  },
  {
    id: '55555555-5555-4555-8555-555555555552',
    user_id: '33333333-3333-4333-8333-333333333333',
    workspace_id: WORKSPACE_ID,
    user_email: 'alice@example.com',
    user_name: 'Alice',
    created_at: '2026-07-02T00:00:00.000Z',
    updated_at: '2026-07-02T00:00:00.000Z',
  },
  {
    id: '55555555-5555-4555-8555-555555555553',
    user_id: '44444444-4444-4444-8444-444444444444',
    workspace_id: WORKSPACE_ID,
    user_email: 'morgan@example.com',
    user_name: 'Morgan',
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
  },
];

const invitations = [
  {
    id: '66666666-6666-4666-8666-666666666661',
    workspace_id: WORKSPACE_ID,
    email: 'zara-invite@example.com',
    expires_at: '2026-08-03T00:00:00.000Z',
    accepted_at: null,
    invited_by_user_id: CURRENT_USER_ID,
    invited_by_display: 'Zara',
    created_at: '2026-07-03T00:00:00.000Z',
    updated_at: '2026-07-03T00:00:00.000Z',
  },
  {
    id: '66666666-6666-4666-8666-666666666662',
    workspace_id: WORKSPACE_ID,
    email: 'alice-invite@example.com',
    expires_at: '2026-08-02T00:00:00.000Z',
    accepted_at: null,
    invited_by_user_id: CURRENT_USER_ID,
    invited_by_display: 'Alice',
    created_at: '2026-07-02T00:00:00.000Z',
    updated_at: '2026-07-02T00:00:00.000Z',
  },
  {
    id: '66666666-6666-4666-8666-666666666663',
    workspace_id: WORKSPACE_ID,
    email: 'morgan-invite@example.com',
    expires_at: '2026-08-01T00:00:00.000Z',
    accepted_at: null,
    invited_by_user_id: CURRENT_USER_ID,
    invited_by_display: 'Morgan',
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
  },
];

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'object' && input !== null && 'url' in input) {
    return String(input.url);
  }
  return String(input);
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
  });
}

function renderSection(fetchImpl: typeof fetch) {
  vi.stubGlobal('fetch', fetchImpl);
  return renderWorkspaceSettingsPage(
    '/w/acme/settings/general',
    <WorkspaceMembersSettingsSection workspaceId={WORKSPACE_ID} workspaceName="Acme" />,
  );
}

describe('WorkspaceMembersSettingsSection', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  test('requests both complete collections and sorts and filters every loaded row', async () => {
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      return Promise.resolve(
        url.endsWith('/members') ? jsonResponse({members}) : jsonResponse({invitations}),
      );
    });

    renderSection(fetchImpl as unknown as typeof fetch);

    const membersTable = await screen.findByRole('table', {name: 'Workspace members'});
    const memberRows = () => within(membersTable).getAllByRole('row');
    await screen.findByText('Zara');
    expect(memberRows()).toHaveLength(4);

    await within(membersTable).getByRole('button', {name: NAME_SORT_BUTTON}).click();
    expect(memberRows()[1]).toHaveTextContent('Alice');
    expect(memberRows()[3]).toHaveTextContent('Zara');

    const memberSearch = screen.getByRole('textbox', {name: 'Search members'});
    await userEvent.setup().type(memberSearch, 'morgan');
    expect(memberRows()).toHaveLength(2);
    expect(memberRows()[1]).toHaveTextContent('Morgan');
    expect(memberRows()[1]).not.toHaveTextContent('Alice');

    const invitationsTable = screen.getByRole('table', {name: 'Pending invitations'});
    expect(within(invitationsTable).getAllByRole('row')).toHaveLength(4);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(
      fetchImpl.mock.calls.every(([input]) => {
        const url = requestUrl(input);
        return !url.includes('limit=');
      }),
    ).toBe(true);
  });

  test('renders the members empty state after a successful empty response', async () => {
    const fetchImpl = vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(
        requestUrl(input).endsWith('/members')
          ? jsonResponse({members: []})
          : jsonResponse({invitations: []}),
      ),
    ) as unknown as typeof fetch;

    renderSection(fetchImpl);

    expect(await screen.findByText('No members yet')).toBeInTheDocument();
    expect(screen.getByRole('table', {name: 'Workspace members'})).toBeInTheDocument();
  });

  test('keeps the four-column member header while loading', async () => {
    const fetchImpl = vi.fn(
      () => new Promise<Response>(() => undefined),
    ) as unknown as typeof fetch;

    renderSection(fetchImpl);

    const membersTable = await screen.findByRole('table', {name: 'Workspace members'});
    expect(within(membersTable).getAllByRole('columnheader')).toHaveLength(4);
    expect(screen.getByRole('row', {name: 'Loading members'})).toBeInTheDocument();
  });

  test('disables removing the current user', async () => {
    const fetchImpl = vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(
        requestUrl(input).endsWith('/members')
          ? jsonResponse({members: [members[0]]})
          : jsonResponse({invitations: []}),
      ),
    ) as unknown as typeof fetch;

    renderSection(fetchImpl);

    const removeButton = await screen.findByRole('button', {name: 'Remove member'});
    expect(removeButton).toBeDisabled();
  });

  test('disables removing the last remaining member', async () => {
    const fetchImpl = vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(
        requestUrl(input).endsWith('/members')
          ? jsonResponse({members: [members[1]]})
          : jsonResponse({invitations: []}),
      ),
    ) as unknown as typeof fetch;

    renderSection(fetchImpl);

    expect(await screen.findByRole('button', {name: 'Remove member'})).toBeDisabled();
  });
});
