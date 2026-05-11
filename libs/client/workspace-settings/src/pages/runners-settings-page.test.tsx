import {configureApiClient} from '@shipfox/client-api';
import {screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  jsonResponse,
  renderWorkspaceSettingsPage,
  WORKSPACE_SETTINGS_TEST_WID,
} from '#test/pages.js';
import {RunnersSettingsPage} from './runners-settings-page.js';

const tokensPath = `/workspaces/${WORKSPACE_SETTINGS_TEST_WID}/runners/tokens`;

function runnerToken(overrides: Partial<Record<string, string | null>> = {}) {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    workspace_id: WORKSPACE_SETTINGS_TEST_WID,
    prefix: 'sf_r_abcdefg',
    name: 'Deploy runner',
    expires_at: '2026-05-09T00:00:00.000Z',
    revoked_at: null,
    created_at: '2026-05-08T00:00:00.000Z',
    updated_at: '2026-05-08T00:00:00.000Z',
    ...overrides,
  };
}

function requestPath(input: RequestInfo | URL): string {
  const url = input instanceof Request ? input.url : input.toString();
  return new URL(url).pathname;
}

function requestMethod(input: RequestInfo | URL): string {
  return input instanceof Request ? input.method : 'GET';
}

function firstButton(name: string): HTMLElement {
  const button = screen.getAllByRole('button', {name})[0];
  if (!button) throw new Error(`Button not found: ${name}`);
  return button;
}

function lastButton(name: string): HTMLElement {
  const buttons = screen.getAllByRole('button', {name});
  const button = buttons.at(-1);
  if (!button) throw new Error(`Button not found: ${name}`);
  return button;
}

describe('RunnersSettingsPage', () => {
  test('renders an empty usable-token state', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({tokens: []}));
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderWorkspaceSettingsPage(
      `/workspaces/${WORKSPACE_SETTINGS_TEST_WID}/settings/runners`,
      <RunnersSettingsPage />,
    );

    expect(await screen.findByText('No usable runner tokens')).toBeVisible();
    expect(screen.getByRole('button', {name: 'Create token'})).toBeVisible();
  });

  test('creates a token and reveals the raw token inline once', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({tokens: []}))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            id: '44444444-4444-4444-8444-444444444444',
            raw_token: 'sf_rt_raw-created-token',
            prefix: 'sf_rt_raw-c',
            name: 'Local runner',
            workspace_id: WORKSPACE_SETTINGS_TEST_WID,
            expires_at: '2026-05-09T00:00:00.000Z',
            created_at: '2026-05-08T00:00:00.000Z',
          },
          {status: 201},
        ),
      )
      .mockResolvedValueOnce(jsonResponse({tokens: [runnerToken({name: 'Local runner'})]}));
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderWorkspaceSettingsPage(
      `/workspaces/${WORKSPACE_SETTINGS_TEST_WID}/settings/runners`,
      <RunnersSettingsPage />,
    );
    await screen.findByText('No usable runner tokens');
    await user.click(screen.getByRole('button', {name: 'Create token'}));
    await user.type(await screen.findByLabelText('Token name'), 'Local runner');
    await user.click(lastButton('Create token'));

    expect(await screen.findByText('Token created')).toBeVisible();
    expect(screen.getByText('sf_rt_raw-created-token')).toBeVisible();
    expect(
      fetchImpl.mock.calls.some(
        ([input]) => requestPath(input) === tokensPath && requestMethod(input) === 'POST',
      ),
    ).toBe(true);
  });

  test('surfaces create errors without clearing the form', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({tokens: []}))
      .mockResolvedValueOnce(
        jsonResponse({message: 'Token quota reached', code: 'quota-reached'}, {status: 422}),
      );
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderWorkspaceSettingsPage(
      `/workspaces/${WORKSPACE_SETTINGS_TEST_WID}/settings/runners`,
      <RunnersSettingsPage />,
    );
    await screen.findByText('No usable runner tokens');
    await user.click(screen.getByRole('button', {name: 'Create token'}));
    await user.type(await screen.findByLabelText('Token name'), 'Local runner');
    await user.click(lastButton('Create token'));

    expect(await screen.findByText('Could not create token')).toBeVisible();
    expect(screen.getByText('Token quota reached')).toBeVisible();
    expect(screen.getByLabelText('Token name')).toHaveValue('Local runner');
  });

  test('revokes a token after row confirmation and removes it from the list', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({tokens: [runnerToken()]}))
      .mockResolvedValueOnce(jsonResponse(runnerToken({revoked_at: '2026-05-08T01:00:00.000Z'})))
      .mockResolvedValueOnce(jsonResponse({tokens: []}));
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderWorkspaceSettingsPage(
      `/workspaces/${WORKSPACE_SETTINGS_TEST_WID}/settings/runners`,
      <RunnersSettingsPage />,
    );
    expect((await screen.findAllByText('Deploy runner')).length).toBeGreaterThan(0);
    await user.click(firstButton('Revoke Deploy runner'));
    await user.click(lastButton('Revoke'));

    await waitFor(() => expect(screen.queryByText('Deploy runner')).not.toBeInTheDocument());
    expect(screen.getByText('No usable runner tokens')).toBeVisible();
    expect(fetchImpl.mock.calls.map(([input]) => requestPath(input))).toContain(
      `${tokensPath}/33333333-3333-4333-8333-333333333333/revoke`,
    );
  });

  test('shows a recoverable revoke error', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({tokens: [runnerToken()]}))
      .mockResolvedValueOnce(
        jsonResponse({message: 'Runner token not found', code: 'not-found'}, {status: 404}),
      );
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderWorkspaceSettingsPage(
      `/workspaces/${WORKSPACE_SETTINGS_TEST_WID}/settings/runners`,
      <RunnersSettingsPage />,
    );
    expect((await screen.findAllByText('Deploy runner')).length).toBeGreaterThan(0);
    await user.click(firstButton('Revoke Deploy runner'));
    await user.click(lastButton('Revoke'));

    expect(await screen.findByText('Runner token not found')).toBeVisible();
    expect(screen.getAllByText('Deploy runner').length).toBeGreaterThan(0);
  });
});
