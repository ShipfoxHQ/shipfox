import {configureApiClient} from '@shipfox/client-api';
import {Toaster} from '@shipfox/react-ui';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {ReactElement} from 'react';
import {
  AGENT_TEST_WORKSPACE_ID,
  agentProviderCatalogResponse,
  agentProviderConfig,
  agentProviderConfigsResponse,
  agentProviderEntry,
  unsupportedAgentProviderEntry,
} from '#test/fixtures/agent-providers.js';
import {WorkspaceAgentProvidersSection} from './agent-providers-section.js';

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
    ...init,
  });
}

function renderAgentProviders(element: ReactElement) {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});

  return render(
    <QueryClientProvider client={queryClient}>
      {element}
      <Toaster />
    </QueryClientProvider>,
  );
}

const ANTHROPIC_FINGERPRINT_RE = /sk-ant-s\.\.\.abcd/;
const OPENAI_FINGERPRINT_RE = /sk-proj\.\.\.abcd/;
function requestPath(input: RequestInfo | URL): string {
  return new URL((input as Request).url).pathname;
}

async function openProviderActions(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByRole('button', {name: `Open ${label} provider actions`}));
}

describe('WorkspaceAgentProvidersSection', () => {
  test('renders configured, available, and unsupported providers', async () => {
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      if (requestPath(input).endsWith('/agent/provider-catalog')) {
        return Promise.resolve(
          jsonResponse(
            agentProviderCatalogResponse([
              agentProviderEntry(),
              agentProviderEntry({
                id: 'openai',
                label: 'OpenAI',
                default_model: 'gpt-5.5-pro',
                models: [{id: 'gpt-5.5-pro', label: 'GPT-5.5 Pro'}],
              }),
              unsupportedAgentProviderEntry(),
            ]),
          ),
        );
      }
      return Promise.resolve(jsonResponse(agentProviderConfigsResponse()));
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderAgentProviders(<WorkspaceAgentProvidersSection workspaceId={AGENT_TEST_WORKSPACE_ID} />);

    expect(await screen.findByText('Configured providers')).toBeVisible();
    expect(await screen.findByText('Anthropic')).toBeVisible();
    expect(screen.getByText('Default provider')).toHaveClass('sr-only');
    expect(screen.queryByText(ANTHROPIC_FINGERPRINT_RE)).not.toBeInTheDocument();
    expect(screen.getByText('Available providers')).toBeVisible();
    expect(screen.getByText('OpenAI')).toBeVisible();
    expect(screen.getByText('Unsupported providers')).toBeVisible();
    expect(screen.getByText('Amazon Bedrock')).toBeVisible();
    expect(screen.getByText('AWS cloud credentials are not supported yet.')).toBeVisible();
  });

  test('waits for configured providers before rendering available provider cards', async () => {
    let resolveConfigs!: (response: Response) => void;
    const configsResponse = new Promise<Response>((resolve) => {
      resolveConfigs = resolve;
    });
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      if (requestPath(input).endsWith('/agent/provider-catalog')) {
        return Promise.resolve(
          jsonResponse(
            agentProviderCatalogResponse([
              agentProviderEntry({
                id: 'openai',
                label: 'OpenAI',
                default_model: 'gpt-5.5-pro',
                models: [{id: 'gpt-5.5-pro', label: 'GPT-5.5 Pro'}],
              }),
            ]),
          ),
        );
      }
      return configsResponse;
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderAgentProviders(<WorkspaceAgentProvidersSection workspaceId={AGENT_TEST_WORKSPACE_ID} />);

    expect(await screen.findByRole('status', {name: 'Loading available providers'})).toBeVisible();
    expect(screen.queryByRole('button', {name: 'Configure OpenAI'})).not.toBeInTheDocument();

    resolveConfigs(
      jsonResponse(agentProviderConfigsResponse({configs: [], default_provider_id: null})),
    );

    expect(await screen.findByRole('button', {name: 'Configure OpenAI'})).toBeVisible();
  });

  test('configures a provider and moves it to configured after save', async () => {
    const user = userEvent.setup();
    let isConfigured = false;
    let requestBody: unknown;
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      if (requestPath(input).endsWith('/agent/provider-catalog')) {
        return Promise.resolve(
          jsonResponse(
            agentProviderCatalogResponse([
              agentProviderEntry({
                id: 'openai',
                label: 'OpenAI',
                default_model: 'gpt-5.5-pro',
                models: [
                  {id: 'gpt-5.5-pro', label: 'GPT-5.5 Pro'},
                  {id: 'gpt-5-mini', label: 'GPT-5 Mini'},
                ],
              }),
            ]),
          ),
        );
      }
      if (request.method === 'PUT') {
        isConfigured = true;
        void request
          .clone()
          .json()
          .then((body) => {
            requestBody = body;
          });
        return Promise.resolve(
          jsonResponse(
            agentProviderConfig({
              provider_id: 'openai',
              default_model: 'gpt-5-mini',
              key_fingerprints: {api_key: 'sk-proj...abcd'},
            }),
          ),
        );
      }
      return Promise.resolve(
        jsonResponse(
          agentProviderConfigsResponse({
            configs: isConfigured
              ? [
                  agentProviderConfig({
                    provider_id: 'openai',
                    default_model: 'gpt-5-mini',
                    key_fingerprints: {api_key: 'sk-proj...abcd'},
                  }),
                ]
              : [],
            default_provider_id: null,
          }),
        ),
      );
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderAgentProviders(<WorkspaceAgentProvidersSection workspaceId={AGENT_TEST_WORKSPACE_ID} />);
    expect(await screen.findByText('No providers configured')).toBeVisible();
    await user.click(screen.getByRole('button', {name: 'Configure OpenAI'}));
    expect(await screen.findByLabelText('Default model')).toHaveValue('__latest__');
    expect(screen.getByRole('option', {name: 'Latest'})).toBeVisible();
    expect(
      screen.getByText(
        'Latest follows the provider catalog default. Currently resolves to GPT-5.5 Pro.',
      ),
    ).toBeVisible();
    await user.selectOptions(screen.getByLabelText('Default model'), 'gpt-5-mini');
    expect(
      screen.queryByText(
        'Latest follows the provider catalog default. Currently resolves to GPT-5.5 Pro.',
      ),
    ).not.toBeInTheDocument();
    expect(screen.getByText('gpt-5-mini')).toBeVisible();
    await user.type(await screen.findByLabelText('API key'), 'sk-proj-secret');
    await user.click(screen.getByRole('button', {name: 'Test & save'}));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() =>
      expect(requestBody).toEqual({
        default_model: 'gpt-5-mini',
        credentials: {api_key: 'sk-proj-secret'},
      }),
    );
    expect(await screen.findByText('OpenAI')).toBeVisible();
    expect(screen.queryByText(OPENAI_FINGERPRINT_RE)).not.toBeInTheDocument();
    expect(screen.queryByText('GPT-5 Mini')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('sk-proj-secret')).not.toBeInTheDocument();
  });

  test('submits null default model when configuring a provider with Latest selected', async () => {
    const user = userEvent.setup();
    let requestBody: unknown;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const request = input as Request;
      if (requestPath(input).endsWith('/agent/provider-catalog')) {
        return jsonResponse(
          agentProviderCatalogResponse([
            agentProviderEntry({
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
          agentProviderConfig({
            provider_id: 'openai',
            default_model: null,
            key_fingerprints: {api_key: 'sk-proj...abcd'},
          }),
        );
      }
      return jsonResponse(agentProviderConfigsResponse({configs: [], default_provider_id: null}));
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderAgentProviders(<WorkspaceAgentProvidersSection workspaceId={AGENT_TEST_WORKSPACE_ID} />);
    await user.click(await screen.findByRole('button', {name: 'Configure OpenAI'}));
    await user.type(await screen.findByLabelText('API key'), 'sk-proj-secret');
    await user.click(screen.getByRole('button', {name: 'Test & save'}));

    await waitFor(() =>
      expect(requestBody).toEqual({
        default_model: null,
        credentials: {api_key: 'sk-proj-secret'},
      }),
    );
  });

  test('shows current fingerprints without echoing secret values while editing', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      if (requestPath(input).endsWith('/agent/provider-catalog')) {
        return Promise.resolve(jsonResponse(agentProviderCatalogResponse()));
      }
      return Promise.resolve(jsonResponse(agentProviderConfigsResponse()));
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderAgentProviders(<WorkspaceAgentProvidersSection workspaceId={AGENT_TEST_WORKSPACE_ID} />);
    expect(await screen.findByText('Anthropic')).toBeVisible();
    expect(screen.queryByText(ANTHROPIC_FINGERPRINT_RE)).not.toBeInTheDocument();
    await openProviderActions(user, 'Anthropic');
    await user.click(screen.getByRole('menuitem', {name: 'Edit credentials'}));

    await waitFor(() =>
      expect(screen.getAllByText('Edit credentials for Anthropic').length).toBeGreaterThan(0),
    );
    expect(await screen.findByText('Current:')).toBeVisible();
    expect(screen.queryByLabelText('Default model')).not.toBeInTheDocument();
    expect(screen.getAllByText(ANTHROPIC_FINGERPRINT_RE).length).toBeGreaterThan(0);
    expect(screen.getByLabelText('API key')).toHaveValue('');
    expect(screen.queryByDisplayValue('sk-ant-secret')).not.toBeInTheDocument();
  });

  test('edits credentials without submitting default model fields', async () => {
    const user = userEvent.setup();
    let requestBody: unknown;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const request = input as Request;
      if (requestPath(input).endsWith('/agent/provider-catalog')) {
        return jsonResponse(
          agentProviderCatalogResponse([
            agentProviderEntry({
              default_model: 'claude-opus-4-8',
              models: [
                {id: 'claude-opus-4-8', label: 'Claude Opus 4.8'},
                {id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5'},
              ],
            }),
          ]),
        );
      }
      if (requestPath(input).endsWith('/agent/providers/anthropic') && request.method === 'PUT') {
        requestBody = await request.clone().json();
        return jsonResponse(agentProviderConfig({default_model: 'claude-haiku-4-5'}));
      }
      return jsonResponse(
        agentProviderConfigsResponse({
          configs: [agentProviderConfig({default_model: 'claude-haiku-4-5'})],
          default_provider_id: 'anthropic',
        }),
      );
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderAgentProviders(<WorkspaceAgentProvidersSection workspaceId={AGENT_TEST_WORKSPACE_ID} />);
    expect(await screen.findByText('Anthropic')).toBeVisible();
    await openProviderActions(user, 'Anthropic');
    await user.click(screen.getByRole('menuitem', {name: 'Edit credentials'}));
    await waitFor(() =>
      expect(screen.getAllByText('Edit credentials for Anthropic').length).toBeGreaterThan(0),
    );
    expect(screen.queryByLabelText('Default model')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('API key'), 'sk-ant-rotated');
    await user.click(screen.getByRole('button', {name: 'Test & save'}));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(requestBody).toEqual({credentials: {api_key: 'sk-ant-rotated'}}));
  });

  test('surfaces provider validation errors without clearing the form', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      if (requestPath(input).endsWith('/agent/provider-catalog')) {
        return Promise.resolve(jsonResponse(agentProviderCatalogResponse()));
      }
      if (request.method === 'PUT') {
        return Promise.resolve(
          jsonResponse(
            {
              code: 'provider-validation-failed',
              message: 'Provider validation failed',
              details: {provider_id: 'anthropic', message: 'Provider rejected the key.'},
            },
            {status: 422},
          ),
        );
      }
      return Promise.resolve(
        jsonResponse(agentProviderConfigsResponse({configs: [], default_provider_id: null})),
      );
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderAgentProviders(<WorkspaceAgentProvidersSection workspaceId={AGENT_TEST_WORKSPACE_ID} />);
    await screen.findByText('No providers configured');
    await user.click(screen.getByRole('button', {name: 'Configure Anthropic'}));
    await user.type(await screen.findByLabelText('API key'), 'sk-ant-secret');
    await user.click(screen.getByRole('button', {name: 'Test & save'}));

    expect(await screen.findByText('Could not save provider')).toBeVisible();
    expect(screen.getByText('Provider rejected the key.')).toBeVisible();
    expect(screen.getByLabelText('API key')).toHaveValue('sk-ant-secret');
  });

  test('sets a configured provider as the default', async () => {
    const user = userEvent.setup();
    let defaultProviderId: 'anthropic' | 'openai' = 'openai';
    let requestBody: unknown;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const request = input as Request;
      if (requestPath(input).endsWith('/agent/provider-catalog')) {
        return jsonResponse(
          agentProviderCatalogResponse([
            agentProviderEntry(),
            agentProviderEntry({
              id: 'openai',
              label: 'OpenAI',
              default_model: 'gpt-5.5-pro',
              models: [{id: 'gpt-5.5-pro', label: 'GPT-5.5 Pro'}],
            }),
          ]),
        );
      }
      if (requestPath(input).endsWith('/agent/default-provider')) {
        requestBody = await request.clone().json();
        defaultProviderId = 'anthropic';
        return jsonResponse({default_provider_id: 'anthropic'});
      }
      return jsonResponse(
        agentProviderConfigsResponse({
          configs: [
            agentProviderConfig(),
            agentProviderConfig({
              provider_id: 'openai',
              key_fingerprints: {api_key: 'sk-proj...abcd'},
            }),
          ],
          default_provider_id: defaultProviderId,
        }),
      );
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderAgentProviders(<WorkspaceAgentProvidersSection workspaceId={AGENT_TEST_WORKSPACE_ID} />);
    expect(await screen.findByText('Anthropic')).toBeVisible();
    await openProviderActions(user, 'Anthropic');
    await user.click(screen.getByRole('menuitem', {name: 'Set as default'}));

    await waitFor(() => expect(requestBody).toEqual({provider_id: 'anthropic'}));
  });

  test('changes a configured provider default model without credentials', async () => {
    const user = userEvent.setup();
    let requestBody: unknown;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const request = input as Request;
      if (requestPath(input).endsWith('/agent/provider-catalog')) {
        return jsonResponse(
          agentProviderCatalogResponse([
            agentProviderEntry({
              default_model: 'claude-opus-4-8',
              models: [
                {id: 'claude-opus-4-8', label: 'Claude Opus 4.8'},
                {id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5'},
              ],
            }),
          ]),
        );
      }
      if (requestPath(input).endsWith('/agent/providers/anthropic/default-model')) {
        requestBody = await request.clone().json();
        return jsonResponse(agentProviderConfig({default_model: null}));
      }
      return jsonResponse(
        agentProviderConfigsResponse({
          configs: [agentProviderConfig({default_model: 'claude-haiku-4-5'})],
          default_provider_id: 'anthropic',
        }),
      );
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderAgentProviders(<WorkspaceAgentProvidersSection workspaceId={AGENT_TEST_WORKSPACE_ID} />);
    expect(await screen.findByText('Anthropic')).toBeVisible();
    await openProviderActions(user, 'Anthropic');
    await user.click(screen.getByRole('menuitem', {name: 'Change default model'}));
    expect(await screen.findByLabelText('Default model')).toHaveValue('claude-haiku-4-5');
    await user.selectOptions(screen.getByLabelText('Default model'), '__latest__');
    expect(
      screen.getByText(
        'Latest follows the provider catalog default. Currently resolves to Claude Opus 4.8.',
      ),
    ).toBeVisible();
    await user.click(screen.getByRole('button', {name: 'Save model'}));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(requestBody).toEqual({default_model: null}));
  });

  test('shows a recoverable set-default error', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      if (requestPath(input).endsWith('/agent/provider-catalog')) {
        return Promise.resolve(
          jsonResponse(
            agentProviderCatalogResponse([
              agentProviderEntry(),
              agentProviderEntry({
                id: 'openai',
                label: 'OpenAI',
                default_model: 'gpt-5.5-pro',
                models: [{id: 'gpt-5.5-pro', label: 'GPT-5.5 Pro'}],
              }),
            ]),
          ),
        );
      }
      if (requestPath(input).endsWith('/agent/default-provider')) {
        return Promise.resolve(
          jsonResponse(
            {code: 'provider-not-configured', message: 'Provider is not configured'},
            {status: 422},
          ),
        );
      }
      return Promise.resolve(
        jsonResponse(
          agentProviderConfigsResponse({
            configs: [
              agentProviderConfig(),
              agentProviderConfig({
                provider_id: 'openai',
                key_fingerprints: {api_key: 'sk-proj...abcd'},
              }),
            ],
            default_provider_id: 'openai',
          }),
        ),
      );
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderAgentProviders(<WorkspaceAgentProvidersSection workspaceId={AGENT_TEST_WORKSPACE_ID} />);
    expect(await screen.findByText('Anthropic')).toBeVisible();
    await openProviderActions(user, 'Anthropic');
    await user.click(screen.getByRole('menuitem', {name: 'Set as default'}));

    expect(
      await screen.findByText('Configure this provider before setting it as the default.'),
    ).toBeVisible();
  });

  test('deletes a configured provider after confirmation', async () => {
    const user = userEvent.setup();
    let isDeleted = false;
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      if (requestPath(input).endsWith('/agent/provider-catalog')) {
        return Promise.resolve(jsonResponse(agentProviderCatalogResponse()));
      }
      if (request.method === 'DELETE') {
        isDeleted = true;
        return Promise.resolve(new Response(null, {status: 204}));
      }
      return Promise.resolve(
        jsonResponse(
          agentProviderConfigsResponse({
            configs: isDeleted ? [] : [agentProviderConfig()],
            default_provider_id: isDeleted ? null : 'anthropic',
          }),
        ),
      );
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderAgentProviders(<WorkspaceAgentProvidersSection workspaceId={AGENT_TEST_WORKSPACE_ID} />);
    expect(await screen.findByText('Anthropic')).toBeVisible();
    await openProviderActions(user, 'Anthropic');
    await user.click(screen.getByRole('menuitem', {name: 'Delete'}));
    await user.click(screen.getByRole('button', {name: 'Delete'}));

    expect(await screen.findByText('No providers configured')).toBeVisible();
  });

  test('disables edit when a configured provider is missing from the catalog', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      if (requestPath(input).endsWith('/agent/provider-catalog')) {
        return Promise.resolve(jsonResponse(agentProviderCatalogResponse([])));
      }
      return Promise.resolve(jsonResponse(agentProviderConfigsResponse()));
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderAgentProviders(<WorkspaceAgentProvidersSection workspaceId={AGENT_TEST_WORKSPACE_ID} />);

    expect(await screen.findByText('anthropic')).toBeVisible();
    await openProviderActions(user, 'anthropic');
    expect(screen.getByRole('menuitem', {name: 'Change default model'})).toHaveAttribute(
      'data-disabled',
    );
    expect(screen.getByRole('menuitem', {name: 'Edit credentials'})).toHaveAttribute(
      'data-disabled',
    );
  });
});
