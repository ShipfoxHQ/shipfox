import {configureApiClient} from '@shipfox/client-api';
import {Toaster} from '@shipfox/react-ui/toast';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {ReactElement} from 'react';
import {
  AGENT_TEST_WORKSPACE_ID,
  modelProviderConfig,
  modelProviderConfigsResponse,
} from '#test/fixtures/model-providers.js';
import {WorkspaceHarnessesSection} from './harnesses-section.js';

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
    ...init,
  });
}

function renderHarnesses(element: ReactElement) {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});

  return render(
    <QueryClientProvider client={queryClient}>
      {element}
      <Toaster />
    </QueryClientProvider>,
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return {promise, resolve};
}

async function openHarnessActions(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByRole('button', {name: `Open ${label} harness actions`}));
}

describe('WorkspaceHarnessesSection', () => {
  test('omits actions on the default row and enables them on an available non-default row', async () => {
    const user = userEvent.setup();
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse(modelProviderConfigsResponse())),
    });

    renderHarnesses(<WorkspaceHarnessesSection workspaceId={AGENT_TEST_WORKSPACE_ID} />);

    expect(await screen.findByText('Harnesses')).toBeVisible();
    expect(await screen.findByText('Default harness')).toHaveClass('sr-only');

    expect(screen.queryByRole('button', {name: 'Open pi harness actions'})).not.toBeInTheDocument();

    await openHarnessActions(user, 'Claude');
    expect(screen.getByRole('menuitem', {name: 'Set as default'})).toBeVisible();
    expect(screen.getByRole('menuitem', {name: 'Set as default'})).not.toHaveAttribute(
      'data-disabled',
    );
  });

  test('disables set as default and shows a warning for an unavailable harness', async () => {
    const user = userEvent.setup();
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn().mockResolvedValue(
        jsonResponse(
          modelProviderConfigsResponse({
            configs: [modelProviderConfig({provider_id: 'openai'})],
          }),
        ),
      ),
    });

    renderHarnesses(<WorkspaceHarnessesSection workspaceId={AGENT_TEST_WORKSPACE_ID} />);

    const claudeRow = (await screen.findByText('Claude')).closest('li');
    if (claudeRow === null) throw new Error('Expected Claude row');
    expect(
      within(claudeRow).getByText('Configure a compatible model provider to use this harness.'),
    ).toHaveClass('sr-only');

    await openHarnessActions(user, 'Claude');

    expect(screen.getByRole('menuitem', {name: 'Set as default'})).toHaveAttribute('data-disabled');
  });

  test('sets the default harness and shows a success toast', async () => {
    const user = userEvent.setup();
    let requestBody: unknown;
    const updateResponse = deferred<Response>();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.method === 'PUT') {
        requestBody = await request.clone().json();
        return await updateResponse.promise;
      }
      return jsonResponse(modelProviderConfigsResponse());
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderHarnesses(<WorkspaceHarnessesSection workspaceId={AGENT_TEST_WORKSPACE_ID} />);

    await screen.findByText('Claude');
    await openHarnessActions(user, 'Claude');
    await user.click(screen.getByRole('menuitem', {name: 'Set as default'}));

    await waitFor(() => expect(requestBody).toEqual({harness_id: 'claude'}));
    expect(screen.getByRole('button', {name: 'Open Claude harness actions'})).toBeDisabled();
    updateResponse.resolve(jsonResponse({default_harness_id: 'claude'}));
    expect(await screen.findByText('Claude is now the default harness')).toBeVisible();
  });

  test('shows an inline error when setting the default harness fails', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.method === 'PUT') {
        return Promise.resolve(jsonResponse({code: 'server-error'}, {status: 500}));
      }
      return Promise.resolve(jsonResponse(modelProviderConfigsResponse()));
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderHarnesses(<WorkspaceHarnessesSection workspaceId={AGENT_TEST_WORKSPACE_ID} />);

    await screen.findByText('Claude');
    await openHarnessActions(user, 'Claude');
    await user.click(screen.getByRole('menuitem', {name: 'Set as default'}));

    await waitFor(() =>
      expect(fetchImpl.mock.calls.some(([input]) => (input as Request).method === 'PUT')).toBe(
        true,
      ),
    );
    expect(await screen.findByText('Could not save default harness. Try again.')).toBeVisible();
  });
});
