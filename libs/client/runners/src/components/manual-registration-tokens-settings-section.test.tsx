import {configureApiClient} from '@shipfox/client-api';
import {Toaster} from '@shipfox/react-ui/toast';
import {formatDate, formatTimestamp} from '@shipfox/react-ui/utils';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {ReactElement} from 'react';
import {WorkspaceManualRegistrationTokensSettingsSection} from './manual-registration-tokens-settings-section.js';

const RUNNERS_TEST_WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const NAME_HEADER = /Name/;
const TOKEN_NAME = /^Token \d+$/;
const EXPIRES_HEADER = /Expires/;
const CREATED_HEADER = /Created/;
const UNSORTED_EXPIRES = /Expires, not sorted/;
const UNSORTED_CREATED = /Created, not sorted/;
const ASCENDING_CREATED = /Created, sorted ascending/;
function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
    ...init,
  });
}

function manualRegistrationToken(overrides: Partial<Record<string, string | null>> = {}) {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    workspace_id: RUNNERS_TEST_WORKSPACE_ID,
    prefix: 'sf_mrt_abcde',
    name: 'Deploy runner',
    expires_at: '2026-05-09T00:00:00.000Z',
    revoked_at: null,
    created_at: '2026-05-08T00:00:00.000Z',
    updated_at: '2026-05-08T00:00:00.000Z',
    ...overrides,
  };
}

function renderManualRegistrationTokens(element: ReactElement) {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});

  return render(
    <QueryClientProvider client={queryClient}>
      {element}
      <Toaster />
    </QueryClientProvider>,
  );
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

async function chooseTokenAction(user: ReturnType<typeof userEvent.setup>, tokenName: string) {
  await user.click(firstButton(`Open ${tokenName} registration token actions`));
  const menuItem = await screen.findByRole('menuitem', {name: 'Revoke token'});
  expect(menuItem.querySelector('svg')).not.toBeInTheDocument();

  await user.click(menuItem);
  expect(await screen.findByRole('dialog')).toBeVisible();
  expect(screen.getByText('Revoke token?')).toBeVisible();
}

describe('WorkspaceManualRegistrationTokensSettingsSection', () => {
  test('keeps the table header and columns visible while loading', () => {
    const fetchImpl = vi.fn(() => new Promise<Response>(() => undefined));
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderManualRegistrationTokens(
      <WorkspaceManualRegistrationTokensSettingsSection workspaceId={RUNNERS_TEST_WORKSPACE_ID} />,
    );

    expect(screen.getAllByRole('columnheader')).toHaveLength(5);
    expect(screen.getByRole('columnheader', {name: NAME_HEADER})).toBeVisible();
    expect(screen.getByRole('columnheader', {name: CREATED_HEADER})).toBeVisible();
  });

  test('sorts every loaded token, including tokens beyond one page', async () => {
    const user = userEvent.setup();
    const tokens = Array.from({length: 51}, (_, index) => {
      const date = new Date(Date.UTC(2026, 0, index + 1)).toISOString();
      return manualRegistrationToken({
        id: `33333333-3333-4333-8333-${String(index).padStart(12, '0')}`,
        name: `Token ${String(index).padStart(2, '0')}`,
        created_at: date,
        expires_at: date,
      });
    });
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({manual_registration_tokens: tokens}));
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderManualRegistrationTokens(
      <WorkspaceManualRegistrationTokensSettingsSection workspaceId={RUNNERS_TEST_WORKSPACE_ID} />,
    );
    await screen.findByText('Token 50');

    const expiresHeader = screen.getByRole('columnheader', {name: EXPIRES_HEADER});
    expect(within(expiresHeader).getByRole('button', {name: UNSORTED_EXPIRES})).toBeVisible();
    const createdHeader = screen.getByRole('columnheader', {name: CREATED_HEADER});
    await user.click(within(createdHeader).getByRole('button', {name: UNSORTED_CREATED}));
    await user.click(within(createdHeader).getByRole('button', {name: ASCENDING_CREATED}));

    const table = screen.getByRole('table', {name: 'Manual registration tokens'});
    const orderedNames = within(table)
      .getAllByText(TOKEN_NAME)
      .map((name) => name.textContent);

    expect(orderedNames).toEqual(tokens.map(({name}) => name).reverse());
  });

  test('renders an empty usable-token state', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({manual_registration_tokens: []}));
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderManualRegistrationTokens(
      <WorkspaceManualRegistrationTokensSettingsSection workspaceId={RUNNERS_TEST_WORKSPACE_ID} />,
    );

    expect(await screen.findByText('No usable manual registration tokens')).toBeVisible();
    expect(screen.getByRole('button', {name: 'Create token'})).toBeVisible();
  });

  test('creates a token and reveals the raw token inline once', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({manual_registration_tokens: []}))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            id: '44444444-4444-4444-8444-444444444444',
            raw_token: 'sf_mrt_raw-created-token',
            prefix: 'sf_mrt_raw-c',
            name: 'Local runner',
            workspace_id: RUNNERS_TEST_WORKSPACE_ID,
            expires_at: '2026-05-09T00:00:00.000Z',
            created_at: '2026-05-08T00:00:00.000Z',
          },
          {status: 201},
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          manual_registration_tokens: [manualRegistrationToken({name: 'Local runner'})],
        }),
      );
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderManualRegistrationTokens(
      <WorkspaceManualRegistrationTokensSettingsSection workspaceId={RUNNERS_TEST_WORKSPACE_ID} />,
    );
    await screen.findByText('No usable manual registration tokens');
    await user.click(screen.getByRole('button', {name: 'Create token'}));
    fireEvent.change(await screen.findByLabelText('Token name'), {
      target: {value: 'Local runner'},
    });
    await user.click(lastButton('Create token'));

    expect(await screen.findByText('Token created')).toBeVisible();
    expect(screen.getByText('sf_mrt_raw-created-token')).toBeVisible();
  });

  test('renders compact dates with exact timestamp tooltips', async () => {
    const user = userEvent.setup();
    const createdAt = '2026-05-08T00:00:00.000Z';
    const expiresAt = '2026-05-09T00:00:00.000Z';
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        manual_registration_tokens: [
          manualRegistrationToken({created_at: createdAt, expires_at: expiresAt}),
        ],
      }),
    );
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderManualRegistrationTokens(
      <WorkspaceManualRegistrationTokensSettingsSection workspaceId={RUNNERS_TEST_WORKSPACE_ID} />,
    );
    const expiresDate = await screen.findAllByText(formatDate(expiresAt));
    const createdDate = await screen.findAllByText(formatDate(createdAt));
    const expiresDateTrigger = expiresDate[0];
    const createdDateTrigger = createdDate[0];
    if (!expiresDateTrigger || !createdDateTrigger) throw new Error('Token dates not rendered');

    expect(screen.queryByText(formatTimestamp(expiresAt))).not.toBeInTheDocument();
    await user.hover(expiresDateTrigger);

    expect(await screen.findByRole('tooltip')).toHaveTextContent(formatTimestamp(expiresAt));

    await user.unhover(expiresDateTrigger);
    await user.hover(createdDateTrigger);

    await waitFor(() => {
      expect(screen.getByRole('tooltip')).toHaveTextContent(formatTimestamp(createdAt));
    });
  });

  test('truncates long token names and shows the full name in a tooltip', async () => {
    const user = userEvent.setup();
    const tokenName = 'self-hosted-runner-for-production-release-candidate-validation-on-metal';
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        manual_registration_tokens: [manualRegistrationToken({name: tokenName})],
      }),
    );
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderManualRegistrationTokens(
      <WorkspaceManualRegistrationTokensSettingsSection workspaceId={RUNNERS_TEST_WORKSPACE_ID} />,
    );
    const nameTrigger = await screen.findAllByRole('button', {name: tokenName});
    const visibleNameTrigger = nameTrigger[0];
    if (!visibleNameTrigger) throw new Error('Token name not rendered');

    expect(screen.getByRole('table')).toHaveClass('table-fixed');
    expect(visibleNameTrigger).toHaveClass('truncate');
    await user.hover(visibleNameTrigger);

    expect(await screen.findByRole('tooltip')).toHaveTextContent(tokenName);
  });

  test('surfaces create errors without clearing the form', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({manual_registration_tokens: []}))
      .mockResolvedValueOnce(
        jsonResponse({message: 'Token quota reached', code: 'quota-reached'}, {status: 422}),
      );
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderManualRegistrationTokens(
      <WorkspaceManualRegistrationTokensSettingsSection workspaceId={RUNNERS_TEST_WORKSPACE_ID} />,
    );
    await screen.findByText('No usable manual registration tokens');
    await user.click(screen.getByRole('button', {name: 'Create token'}));
    fireEvent.change(await screen.findByLabelText('Token name'), {
      target: {value: 'Local runner'},
    });
    await user.click(lastButton('Create token'));

    expect(await screen.findByText('Could not create token')).toBeVisible();
    expect(screen.getByText('Token quota reached')).toBeVisible();
    expect(screen.getByLabelText('Token name')).toHaveValue('Local runner');
  });

  test('revokes a token after row confirmation and removes it from the list', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({manual_registration_tokens: [manualRegistrationToken()]}),
      )
      .mockResolvedValueOnce(
        jsonResponse(manualRegistrationToken({revoked_at: '2026-05-08T01:00:00.000Z'})),
      )
      .mockResolvedValueOnce(jsonResponse({manual_registration_tokens: []}));
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderManualRegistrationTokens(
      <WorkspaceManualRegistrationTokensSettingsSection workspaceId={RUNNERS_TEST_WORKSPACE_ID} />,
    );
    expect((await screen.findAllByText('Deploy runner')).length).toBeGreaterThan(0);
    await chooseTokenAction(user, 'Deploy runner');
    await user.click(lastButton('Revoke'));

    await waitFor(() => expect(screen.queryByText('Deploy runner')).not.toBeInTheDocument());
    expect(screen.getByText('No usable manual registration tokens')).toBeVisible();
  });

  test('shows a recoverable revoke error', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({manual_registration_tokens: [manualRegistrationToken()]}),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {message: 'Manual registration token not found', code: 'not-found'},
          {status: 404},
        ),
      );
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderManualRegistrationTokens(
      <WorkspaceManualRegistrationTokensSettingsSection workspaceId={RUNNERS_TEST_WORKSPACE_ID} />,
    );
    expect((await screen.findAllByText('Deploy runner')).length).toBeGreaterThan(0);
    await chooseTokenAction(user, 'Deploy runner');
    await user.click(lastButton('Revoke'));

    expect(await screen.findByText('Manual registration token not found')).toBeVisible();
    expect(screen.getAllByText('Deploy runner').length).toBeGreaterThan(0);
  });
});
