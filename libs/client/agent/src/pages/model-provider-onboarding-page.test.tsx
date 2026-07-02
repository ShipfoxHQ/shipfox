import {configureApiClient} from '@shipfox/client-api';
import {Toaster} from '@shipfox/react-ui';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {ReactElement} from 'react';
import {isModelProviderOnboardingDismissed} from '#state/model-provider-onboarding.js';
import {
  AGENT_TEST_WORKSPACE_ID,
  modelProviderCatalogResponse,
  modelProviderConfig,
  modelProviderEntry,
  testModelProviderEntries,
} from '#test/fixtures/model-providers.js';
import {ModelProviderOnboardingPage} from './model-provider-onboarding-page.js';

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
    ...init,
  });
}

function requestPath(input: RequestInfo | URL): string {
  return new URL((input as Request).url).pathname;
}

function renderOnboarding(element: ReactElement) {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});

  return render(
    <QueryClientProvider client={queryClient}>
      {element}
      <Toaster />
    </QueryClientProvider>,
  );
}

describe('ModelProviderOnboardingPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test('skips setup, records the dismissed flag, and does not save a provider', async () => {
    const user = userEvent.setup();
    const onSkip = vi.fn();
    const onConfigured = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(modelProviderCatalogResponse()));
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderOnboarding(
      <ModelProviderOnboardingPage
        workspaceId={AGENT_TEST_WORKSPACE_ID}
        onSkip={onSkip}
        onConfigured={onConfigured}
      />,
    );

    await user.click(screen.getByRole('button', {name: 'Skip for now'}));

    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onConfigured).not.toHaveBeenCalled();
    expect(isModelProviderOnboardingDismissed(AGENT_TEST_WORKSPACE_ID)).toBe(true);
    expect(fetchImpl.mock.calls.some(([input]) => (input as Request).method === 'PUT')).toBe(false);
  });

  test('places skip before the model provider choices', async () => {
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse(modelProviderCatalogResponse())),
    });

    renderOnboarding(
      <ModelProviderOnboardingPage
        workspaceId={AGENT_TEST_WORKSPACE_ID}
        onSkip={vi.fn()}
        onConfigured={vi.fn()}
      />,
    );

    const skip = screen.getByRole('button', {name: 'Skip for now'});
    const provider = await screen.findByRole('button', {
      name: `Configure ${modelProviderEntry().label}`,
    });

    expect(skip.compareDocumentPosition(provider)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  test('filters supported model providers and clears a no-match search', async () => {
    const user = userEvent.setup();
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi
        .fn()
        .mockResolvedValue(jsonResponse(modelProviderCatalogResponse(testModelProviderEntries(9)))),
    });

    renderOnboarding(
      <ModelProviderOnboardingPage
        workspaceId={AGENT_TEST_WORKSPACE_ID}
        onSkip={vi.fn()}
        onConfigured={vi.fn()}
      />,
    );
    const search = await screen.findByRole('searchbox', {name: 'Search model providers'});

    await user.type(search, 'provider 6');

    expect(screen.getByRole('button', {name: 'Configure Provider 6'})).toBeVisible();
    expect(screen.queryByRole('button', {name: 'Configure Provider 1'})).not.toBeInTheDocument();
    await user.clear(search);
    await user.type(search, 'missing');
    expect(screen.getByText('No model providers match "missing"')).toBeVisible();
    await user.click(screen.getByRole('button', {name: 'Clear search'}));

    expect(screen.getByRole('button', {name: 'Configure Provider 1'})).toBeVisible();
    await waitFor(() => expect(search).toHaveFocus());
  });

  test('skip still continues when localStorage rejects the dismissed write', async () => {
    const user = userEvent.setup();
    const onSkip = vi.fn();
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    try {
      configureApiClient({
        baseUrl: 'https://api.example.test',
        fetchImpl: vi.fn().mockResolvedValue(jsonResponse(modelProviderCatalogResponse())),
      });

      renderOnboarding(
        <ModelProviderOnboardingPage
          workspaceId={AGENT_TEST_WORKSPACE_ID}
          onSkip={onSkip}
          onConfigured={vi.fn()}
        />,
      );

      await user.click(screen.getByRole('button', {name: 'Skip for now'}));

      expect(onSkip).toHaveBeenCalledTimes(1);
    } finally {
      setItem.mockRestore();
    }
  });

  test('saves the selected model provider as default in one upsert request', async () => {
    const user = userEvent.setup();
    const onConfigured = vi.fn();
    let requestBody: unknown;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const request = input as Request;
      if (requestPath(input).endsWith('/agent/model-provider-catalog')) {
        return jsonResponse(
          modelProviderCatalogResponse([
            modelProviderEntry({
              id: 'openai',
              label: 'OpenAI',
              default_model: 'gpt-5.5-pro',
              models: [{id: 'gpt-5.5-pro', label: 'GPT-5.5 Pro'}],
            }),
          ]),
        );
      }
      if (request.method === 'PUT') {
        requestBody = await request.clone().json();
        return jsonResponse(
          modelProviderConfig({
            model_provider_id: 'openai',
            default_model: null,
            key_fingerprints: {'credential:api_key': 'sk-proj...abcd'},
          }),
        );
      }
      return jsonResponse({}, {status: 404});
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderOnboarding(
      <ModelProviderOnboardingPage
        workspaceId={AGENT_TEST_WORKSPACE_ID}
        onSkip={vi.fn()}
        onConfigured={onConfigured}
      />,
    );

    await user.click(await screen.findByRole('button', {name: 'Configure OpenAI'}));
    await user.type(await screen.findByLabelText('API key'), 'sk-proj-secret');
    await user.click(screen.getByRole('button', {name: 'Test & save'}));

    await waitFor(() =>
      expect(requestBody).toEqual({
        default_model: null,
        credentials: {api_key: 'sk-proj-secret'},
        set_as_default: true,
      }),
    );
    expect(onConfigured).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole('dialog', {name: 'Use OpenAI in a workflow'}),
    ).not.toBeInTheDocument();
  });

  test('keeps skip available when the catalog fails to load', async () => {
    const user = userEvent.setup();
    const onSkip = vi.fn();
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse({code: 'server-error'}, {status: 500})),
    });

    renderOnboarding(
      <ModelProviderOnboardingPage
        workspaceId={AGENT_TEST_WORKSPACE_ID}
        onSkip={onSkip}
        onConfigured={vi.fn()}
      />,
    );

    expect(await screen.findByText("Couldn't load model provider catalog")).toBeInTheDocument();
    await user.click(screen.getByRole('button', {name: 'Skip for now'}));

    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});
