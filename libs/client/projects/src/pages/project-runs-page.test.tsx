import {configureApiClient} from '@shipfox/client-api';
import {fireEvent, screen, waitFor} from '@testing-library/react';
import {jsonResponse, PROJECT_TEST_WID, renderProjectPage} from '#test/pages.js';
import {localWorkflowRunStatusVariant, ProjectRunsPage} from './project-runs-page.js';

const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const FAKE_ALERT_TRIGGERED_RE = /Fake alert triggered/;

describe('ProjectRunsPage', () => {
  test('renders local-service run history', async () => {
    configureApiClient({fetchImpl: createRunsFetch()});

    renderProjectPage(
      `/workspaces/${PROJECT_TEST_WID}/projects/${PROJECT_ID}/runs`,
      <ProjectRunsPage projectId={PROJECT_ID} />,
    );

    expect(await screen.findByRole('heading', {name: 'Runs'})).toBeInTheDocument();
    expect(await screen.findByText('restore_checkout')).toBeInTheDocument();
    expect(screen.getByText('completed')).toBeInTheDocument();
  });

  test('triggers a fake alert through the platform route', async () => {
    const fetchImpl = createRunsFetch();
    configureApiClient({fetchImpl});

    renderProjectPage(
      `/workspaces/${PROJECT_TEST_WID}/projects/${PROJECT_ID}/runs`,
      <ProjectRunsPage projectId={PROJECT_ID} />,
    );

    fireEvent.click(await screen.findByRole('button', {name: 'Fake alert'}));

    expect(await screen.findByText(FAKE_ALERT_TRIGGERED_RE)).toBeInTheDocument();
    await waitFor(() => {
      expect(
        fetchImpl.mock.calls.some(([input]) => {
          const request = input instanceof Request ? input : null;
          return (
            request?.url ===
              'https://api.example.test/local-workflows/projects/44444444-4444-4444-8444-444444444444/fake-alerts' &&
            request.method === 'POST'
          );
        }),
      ).toBe(true);
    });
  });

  test('shows an empty state when no runs are returned', async () => {
    configureApiClient({
      fetchImpl: createRunsFetch({runs: jsonResponse({runs: []})}),
    });

    renderProjectPage(
      `/workspaces/${PROJECT_TEST_WID}/projects/${PROJECT_ID}/runs`,
      <ProjectRunsPage projectId={PROJECT_ID} />,
    );

    expect(await screen.findByText('No local runs yet')).toBeInTheDocument();
  });

  test('maps unknown local-service run statuses to neutral', () => {
    const result = localWorkflowRunStatusVariant('queued_by_future_service');

    expect(result).toBe('neutral');
  });
});

function createRunsFetch({
  status = jsonResponse(statusDto()),
  runs = jsonResponse(runsDto()),
  trigger = jsonResponse(triggerResponseDto()),
}: {
  status?: Response;
  runs?: Response;
  trigger?: Response;
} = {}) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = new URL(requestInputUrl(input));

    if (url.pathname === `/local-workflows/projects/${PROJECT_ID}/status`) {
      return Promise.resolve(status.clone());
    }
    if (url.pathname === `/local-workflows/projects/${PROJECT_ID}/runs`) {
      return Promise.resolve(runs.clone());
    }
    if (url.pathname === `/local-workflows/projects/${PROJECT_ID}/fake-alerts`) {
      return Promise.resolve(trigger.clone());
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

function runsDto() {
  return {
    runs: [
      {
        run_id: 'fake-monitoring-alert-001',
        module_id: 'restore_checkout_exec.fox',
        trigger_name: 'checkout_degraded',
        workflow_name: 'restore_checkout',
        provider_event_id: 'alert-001',
        status: 'completed',
      },
    ],
  };
}

function triggerResponseDto() {
  return {
    run_id: 'fake-monitoring-alert-002',
    result: {
      status: 'completed',
      run: {
        run: {
          run_id: 'fake-monitoring-alert-002',
          workflow_name: 'restore_checkout',
          status: 'completed',
        },
        actions: [],
        events: [],
      },
    },
  };
}
