import {configureApiClient} from '@shipfox/client-api';
import {fireEvent, screen} from '@testing-library/react';
import {jsonResponse, PROJECT_TEST_WID, renderProjectPage} from '#test/pages.js';
import {ProjectWorkflowsPage} from './project-workflows-page.js';

const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const WORKFLOW_ID = 'restore_checkout_exec.fox::workflow:restore_checkout';

describe('ProjectWorkflowsPage', () => {
  test('renders local workflows and source text', async () => {
    configureApiClient({fetchImpl: createLocalWorkflowsFetch()});

    renderProjectPage(
      `/workspaces/${PROJECT_TEST_WID}/projects/${PROJECT_ID}/workflows`,
      <ProjectWorkflowsPage projectId={PROJECT_ID} />,
    );

    expect(await screen.findByRole('heading', {name: 'Workflows'})).toBeInTheDocument();
    expect((await screen.findAllByText('restore_checkout'))[0]).toBeInTheDocument();
    expect(await screen.findByText((content) => content.includes('exec.run'))).toBeInTheDocument();
  });

  test('switches between fox source and iface text', async () => {
    configureApiClient({fetchImpl: createLocalWorkflowsFetch()});

    renderProjectPage(
      `/workspaces/${PROJECT_TEST_WID}/projects/${PROJECT_ID}/workflows`,
      <ProjectWorkflowsPage projectId={PROJECT_ID} />,
    );

    const ifaceButton = await screen.findByRole('button', {name: 'iface'});
    fireEvent.click(ifaceButton);

    expect(await screen.findByText('interface CheckoutAlert')).toBeInTheDocument();
  });

  test('shows service-down state', async () => {
    configureApiClient({
      fetchImpl: createLocalWorkflowsFetch({
        status: jsonResponse({
          base_url: 'http://127.0.0.1:8765',
          reachable: false,
          latest_fake_alert: null,
          setup_hint: 'Start the Foxlang V0 Local Service on the configured base URL.',
        }),
        workflows: jsonResponse({code: 'local-service-unavailable'}, {status: 503}),
      }),
    });

    renderProjectPage(
      `/workspaces/${PROJECT_TEST_WID}/projects/${PROJECT_ID}/workflows`,
      <ProjectWorkflowsPage projectId={PROJECT_ID} />,
    );

    expect(await screen.findByText('Local service unavailable')).toBeInTheDocument();
    expect(await screen.findByText('Workflows unavailable')).toBeInTheDocument();
  });
});

function createLocalWorkflowsFetch({
  status = jsonResponse(statusDto()),
  workflows = jsonResponse(workflowListDto()),
  workflow = jsonResponse(workflowDetailDto()),
}: {
  status?: Response;
  workflows?: Response;
  workflow?: Response;
} = {}) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = new URL(requestInputUrl(input));

    if (url.pathname === `/local-workflows/projects/${PROJECT_ID}/status`) {
      return Promise.resolve(status.clone());
    }
    if (url.pathname === `/local-workflows/projects/${PROJECT_ID}/workflows`) {
      return Promise.resolve(workflows.clone());
    }
    if (
      url.pathname ===
      `/local-workflows/projects/${PROJECT_ID}/workflows/${encodeURIComponent(WORKFLOW_ID)}`
    ) {
      return Promise.resolve(workflow.clone());
    }
    return Promise.resolve(jsonResponse({code: 'not-found'}, {status: 404}));
  });
}

function requestInputUrl(input: RequestInfo | URL) {
  if (input instanceof Request) return input.url;
  return String(input);
}

function statusDto() {
  return {
    base_url: 'http://127.0.0.1:8765',
    reachable: true,
    latest_fake_alert: null,
    setup_hint: null,
  };
}

function workflowListDto() {
  return {
    workflows: [
      {
        preparation_id: 'prep-1',
        registered_at: '2026-05-31T12:00:00Z',
        workflow: {
          workflow_id: WORKFLOW_ID,
          module_id: 'restore_checkout_exec.fox',
          name: 'restore_checkout',
          return_type: 'ExecResult',
        },
        triggers: [],
        action_requirements: [],
      },
    ],
  };
}

function workflowDetailDto() {
  return {
    preparation_id: 'prep-1',
    workflow: {
      workflow_id: WORKFLOW_ID,
      module_id: 'restore_checkout_exec.fox',
      name: 'restore_checkout',
      return_type: 'ExecResult',
    },
    module: {},
    triggers: [],
    required_services: [],
    action_requirements: [],
    source: {
      source_name: 'restore_checkout_exec.fox',
      source_text:
        'workflow restore_checkout(alert: CheckoutAlert) { return exec.run(["printf", "hello"]) }',
    },
    iface_text: 'interface CheckoutAlert',
  };
}
