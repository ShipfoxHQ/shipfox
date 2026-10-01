import {configureApiClient} from '@shipfox/client-api';
import type {ChromeSlots} from '@shipfox/client-shell/runtime';
import {fireEvent, screen, waitFor, within} from '@testing-library/react';
import {useState} from 'react';
import {
  jsonResponse,
  PROJECT_TEST_WID,
  PROJECT_TEST_WSLUG,
  renderProjectPage,
} from '#test/pages.js';
import {ProjectWorkflowsPage} from './project-workflows-page.js';

const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const CONNECTION_ID = '33333333-3333-4333-8333-333333333333';
const DEFINITION_ID = '55555555-5555-4555-8555-555555555555';
const DEPLOY_WORKFLOW_ROW_REGEX = /Deploy production/;

describe('ProjectWorkflowsPage', () => {
  test('renders workflow definitions and their panel regions', async () => {
    configureApiClient({fetchImpl: createProjectDetailFetch()});

    renderWorkflowsPage();

    expect((await screen.findAllByText('Deploy production'))[0]).toBeInTheDocument();
    expect(screen.getByRole('heading', {name: 'Workflows'})).toHaveClass('sr-only');
    expect(
      screen.queryByText('Synced workflow definitions for this project source.'),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText('.shipfox/workflows/deploy.yml')[0]).toBeInTheDocument();
    const sourcePanel = screen
      .getByRole('region', {name: 'Project source'})
      .closest('[data-slot="panel"]');
    const definitionsRegion = screen.getByRole('region', {name: 'Workflow definitions'});
    const definitionsPanel = within(definitionsRegion)
      .getByRole('table', {name: 'Workflow definitions table'})
      .closest('[data-slot="panel"]');
    expect(sourcePanel).toBeInTheDocument();
    expect(definitionsRegion).toBeInTheDocument();
    expect(definitionsPanel).toBeInTheDocument();
    expect(sourcePanel).not.toBe(definitionsPanel);
    expect(screen.getByRole('table').closest('[data-slot="panel"]')).toBe(definitionsPanel);
    expect(screen.getByRole('row', {name: DEPLOY_WORKFLOW_ROW_REGEX})).toHaveAttribute(
      'data-row-id',
      '55555555-5555-4555-8555-555555555555',
    );
    // Source strip resolves connection display_name from the integrations
    // workspace cache; external_repository_id renders as a Code chip.
    expect(await screen.findByText('Acme GitHub')).toBeInTheDocument();
    expect(screen.getAllByText('platform')[0]).toBeInTheDocument();
    expect(screen.getAllByText('succeeded')[0]).toBeInTheDocument();
    expect(screen.queryByRole('heading', {name: 'Source identity'})).not.toBeInTheDocument();
  });

  test('shows definitions error while keeping the source strip visible', async () => {
    configureApiClient({
      fetchImpl: createProjectDetailFetch({
        definitions: jsonResponse({code: 'server-error'}, {status: 500}),
      }),
    });

    renderWorkflowsPage();

    expect(await screen.findByText("Couldn't load workflows")).toBeInTheDocument();
    // SyncBadge in the strip falls back to Unavailable when sync is undefined
    // (definitions errored before providing one).
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.getByRole('region', {name: 'Project source'})).toBeInTheDocument();
  });

  test('shows the sync failure and its diagnostics when definitions are invalid', async () => {
    configureApiClient({
      fetchImpl: createProjectDetailFetch({
        definitions: jsonResponse(
          definitionsDto({
            definitions: [],
            sync: {
              ref: 'main',
              status: 'failed',
              last_sync_at: '2026-05-07T01:00:00.000Z',
              started_at: '2026-05-07T01:00:00.000Z',
              finished_at: null,
              last_error_code: 'invalid-definition',
              last_error_message: 'Workflow definitions are invalid',
              diagnostics: [
                {
                  code: 'invalid-definition',
                  message: 'Step gate success must be a valid CEL boolean expression: No such key',
                  path: 'jobs.build.steps.0.gate.success',
                  file_path: '.shipfox/workflows/invalid.yml',
                  severity: 'error',
                },
                {
                  code: 'invalid-definition',
                  message: 'Another validation error: invalid value',
                  path: 'jobs.build.steps.1.gate.success',
                  file_path: '.shipfox/workflows/invalid.yml',
                  severity: 'error',
                },
              ],
            },
          }),
        ),
      }),
    });

    renderWorkflowsPage();

    expect(await screen.findByText('Workflow sync failed')).toBeInTheDocument();
    expect(screen.getAllByText('Workflow definitions are invalid').length).toBeGreaterThan(0);
    expect(screen.getByText('Workflow definition errors')).toBeInTheDocument();
    expect(screen.getByText('.shipfox/workflows/invalid.yml')).toHaveClass('break-all');
    expect(screen.getByText('jobs.build.steps.0.gate.success')).toHaveClass('break-all');
    expect(
      screen.getByText('Step gate success must be a valid CEL boolean expression: No such key'),
    ).toHaveClass('text-tag-error-text');
    expect(screen.getByText('jobs.build.steps.1.gate.success')).toBeInTheDocument();
  });

  test('shows no sync failure when the repository has no workflow files', async () => {
    configureApiClient({
      fetchImpl: createProjectDetailFetch({
        definitions: jsonResponse(
          definitionsDto({
            definitions: [],
            sync: {
              ref: 'main',
              status: 'failed',
              last_sync_at: '2026-05-07T01:00:00.000Z',
              started_at: '2026-05-07T01:00:00.000Z',
              finished_at: null,
              last_error_code: 'no-workflow-files',
              last_error_message: 'No workflow files found',
              diagnostics: [],
            },
          }),
        ),
      }),
    });

    renderWorkflowsPage();

    expect(
      await screen.findByText('No workflow files found under .shipfox/workflows/.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Workflow sync failed')).not.toBeInTheDocument();
  });

  test('keeps the sync failure when definitions remain after the workflow files are removed', async () => {
    configureApiClient({
      fetchImpl: createProjectDetailFetch({
        definitions: jsonResponse(
          definitionsDto({
            sync: {
              ref: 'main',
              status: 'failed',
              last_sync_at: '2026-05-07T01:00:00.000Z',
              started_at: '2026-05-07T01:00:00.000Z',
              finished_at: null,
              last_error_code: 'no-workflow-files',
              last_error_message: 'No workflow files found',
              diagnostics: [],
            },
          }),
        ),
      }),
    });

    renderWorkflowsPage();

    expect((await screen.findAllByText('Deploy production'))[0]).toBeInTheDocument();
    expect(screen.getByText('Workflow sync failed')).toBeInTheDocument();
  });

  describe('first workflow panel slot', () => {
    function FirstWorkflowPanel({projectId}: {projectId: string}) {
      return <div>First workflow panel for {projectId}</div>;
    }

    function emptyDefinitions(status: 'pending' | 'syncing' | 'succeeded' | 'failed') {
      return jsonResponse(
        definitionsDto({
          definitions: [],
          sync: {
            ref: 'main',
            status,
            last_sync_at: '2026-05-07T01:00:00.000Z',
            started_at: '2026-05-07T01:00:00.000Z',
            finished_at: null,
            last_error_code: status === 'failed' ? 'no-workflow-files' : null,
            last_error_message: status === 'failed' ? 'No workflow files found' : null,
            diagnostics: [],
          },
        }),
      );
    }

    test.each([
      'succeeded',
      'failed',
    ] as const)('renders the slot in place of the empty list after a %s sync', async (status) => {
      configureApiClient({
        fetchImpl: createProjectDetailFetch({definitions: emptyDefinitions(status)}),
      });

      renderWorkflowsPage({FirstWorkflowPanel});

      expect(await screen.findByText(`First workflow panel for ${PROJECT_ID}`)).toBeInTheDocument();
      expect(screen.getByRole('region', {name: 'Project source'})).toBeInTheDocument();
      expect(screen.queryByRole('region', {name: 'Workflow definitions'})).not.toBeInTheDocument();
      expect(screen.queryByText('Workflow sync failed')).not.toBeInTheDocument();
    });

    test('renders the slot with the sync failure when the only files are invalid', async () => {
      configureApiClient({
        fetchImpl: createProjectDetailFetch({
          definitions: jsonResponse(
            definitionsDto({
              definitions: [],
              sync: {
                ref: 'main',
                status: 'failed',
                last_sync_at: '2026-05-07T01:00:00.000Z',
                started_at: '2026-05-07T01:00:00.000Z',
                finished_at: null,
                last_error_code: 'invalid-definition',
                last_error_message: 'Workflow definitions are invalid',
                diagnostics: [],
              },
            }),
          ),
        }),
      });

      renderWorkflowsPage({FirstWorkflowPanel});

      expect(await screen.findByText(`First workflow panel for ${PROJECT_ID}`)).toBeInTheDocument();
      expect(screen.getByText('Workflow sync failed')).toBeInTheDocument();
    });

    test('does not render the slot when the project has definitions', async () => {
      configureApiClient({fetchImpl: createProjectDetailFetch()});

      renderWorkflowsPage({FirstWorkflowPanel});

      expect((await screen.findAllByText('Deploy production'))[0]).toBeInTheDocument();
      expect(screen.queryByText(`First workflow panel for ${PROJECT_ID}`)).not.toBeInTheDocument();
    });

    test.each([
      'pending',
      'syncing',
    ] as const)('does not render the slot while sync is %s', async (status) => {
      configureApiClient({
        fetchImpl: createProjectDetailFetch({definitions: emptyDefinitions(status)}),
      });

      renderWorkflowsPage({FirstWorkflowPanel});

      expect(await screen.findByText('No workflows')).toBeInTheDocument();
      expect(screen.queryByText(`First workflow panel for ${PROJECT_ID}`)).not.toBeInTheDocument();
    });

    test('does not render the slot when definitions fail to load', async () => {
      configureApiClient({
        fetchImpl: createProjectDetailFetch({
          definitions: jsonResponse({code: 'server-error'}, {status: 500}),
        }),
      });

      renderWorkflowsPage({FirstWorkflowPanel});

      expect(await screen.findByText("Couldn't load workflows")).toBeInTheDocument();
      expect(screen.queryByText(`First workflow panel for ${PROJECT_ID}`)).not.toBeInTheDocument();
    });

    test("does not render the slot from the previous project's definitions", async () => {
      const emptyProjectId = '66666666-6666-4666-8666-666666666666';
      const detailFetch = createProjectDetailFetch({definitions: emptyDefinitions('succeeded')});
      configureApiClient({
        fetchImpl: vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(requestInputUrl(input));
          if (url.pathname === `/projects/${emptyProjectId}`) {
            return Promise.resolve(jsonResponse({...projectDto(), id: emptyProjectId}));
          }
          if (
            url.pathname === '/definitions' &&
            url.searchParams.get('project_id') === PROJECT_ID
          ) {
            return new Promise<Response>(() => undefined);
          }
          return detailFetch(input, init);
        }),
      });

      function SwitchingPage() {
        const [projectId, setProjectId] = useState(emptyProjectId);
        return (
          <>
            <button type="button" onClick={() => setProjectId(PROJECT_ID)}>
              Switch project
            </button>
            <ProjectWorkflowsPage projectId={projectId} />
          </>
        );
      }
      renderProjectPage(`/w/${PROJECT_TEST_WSLUG}/p/project/workflows`, () => <SwitchingPage />, {
        FirstWorkflowPanel,
      });

      expect(
        await screen.findByText(`First workflow panel for ${emptyProjectId}`),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', {name: 'Switch project'}));

      await waitFor(() =>
        expect(
          screen.queryByText(`First workflow panel for ${emptyProjectId}`),
        ).not.toBeInTheDocument(),
      );
      // The new project's page renders with the previous project's empty list
      // as placeholder data while its own definitions load.
      expect(await screen.findByText('No workflows')).toBeInTheDocument();
      expect(screen.queryByText(`First workflow panel for ${PROJECT_ID}`)).not.toBeInTheDocument();
    });

    test('renders only the empty state when the slot is absent', async () => {
      configureApiClient({
        fetchImpl: createProjectDetailFetch({definitions: emptyDefinitions('succeeded')}),
      });

      renderWorkflowsPage();

      expect(await screen.findByText('No workflow definitions found.')).toBeInTheDocument();
      expect(screen.queryByText(`First workflow panel for ${PROJECT_ID}`)).not.toBeInTheDocument();
    });
  });

  test('shows definition warnings without rendering a sync failure', async () => {
    configureApiClient({
      fetchImpl: createProjectDetailFetch({
        definitions: jsonResponse(
          definitionsDto({
            sync: {
              ref: 'main',
              status: 'succeeded',
              last_sync_at: '2026-05-07T01:00:00.000Z',
              started_at: '2026-05-07T00:59:55.000Z',
              finished_at: '2026-05-07T01:00:00.000Z',
              last_error_code: null,
              last_error_message: null,
              diagnostics: [
                {
                  code: 're-evaluating-command',
                  message: 'Workflow data is re-executed as shell code.',
                  path: 'jobs.build.steps.0.run',
                  file_path: '.shipfox/workflows/warning.yml',
                  severity: 'warning',
                },
                {
                  code: 're-evaluating-command',
                  message: 'Workflow data is re-executed as shell code.',
                  path: 'jobs.build.steps.0.run',
                  file_path: '.shipfox/workflows/warning.yml',
                  severity: 'warning',
                },
              ],
            },
          }),
        ),
      }),
    });

    renderWorkflowsPage();

    expect(await screen.findByText('Workflow definition warnings')).toBeInTheDocument();
    // Both warnings group under the shared workflow file; the file label renders once.
    expect(screen.getAllByText('Workflow data is re-executed as shell code.')).toHaveLength(2);
    expect(screen.getAllByText('.shipfox/workflows/warning.yml')).toHaveLength(1);
    expect(screen.getAllByText('jobs.build.steps.0.run')).toHaveLength(2);
    expect(
      screen.getByText('Workflow definition warnings').closest('[data-slot="callout"]'),
    ).toHaveAttribute('role', 'status');
    expect(screen.queryByText('Workflow sync failed')).not.toBeInTheDocument();
  });

  test('points an action manifest diagnostic at its action.yml path', async () => {
    configureApiClient({
      fetchImpl: createProjectDetailFetch({
        definitions: jsonResponse(
          definitionsDto({
            sync: {
              ref: 'main',
              status: 'succeeded',
              last_sync_at: '2026-09-27T01:00:00.000Z',
              started_at: '2026-09-27T00:59:55.000Z',
              finished_at: '2026-09-27T01:00:00.000Z',
              last_error_code: null,
              last_error_message: null,
              diagnostics: [
                {
                  code: 'action-invalid',
                  message: 'Action main file index.ts is not in ./.shipfox/actions/thread',
                  path: 'main',
                  file_path: '.shipfox/actions/thread/action.yml',
                  severity: 'error',
                },
              ],
            },
          }),
        ),
      }),
    });

    renderWorkflowsPage();

    const title = await screen.findByText('Workflow definition errors');
    const callout = title.closest('[data-slot="callout"]');
    if (!(callout instanceof HTMLElement)) throw new Error('Diagnostics callout was not rendered');
    const file = within(callout).getByText('.shipfox/actions/thread/action.yml');
    if (!(file.parentElement instanceof HTMLElement))
      throw new Error('File group was not rendered');
    expect(within(file.parentElement).getByText('main')).toBeInTheDocument();
    expect(file.parentElement).toHaveTextContent(
      'Error: Action main file index.ts is not in ./.shipfox/actions/thread',
    );
  });

  test('shows errors and warnings together with severity labels, grouped by file path', async () => {
    configureApiClient({
      fetchImpl: createProjectDetailFetch({
        definitions: jsonResponse(
          definitionsDto({
            sync: {
              ref: 'main',
              status: 'succeeded',
              last_sync_at: '2026-05-07T01:00:00.000Z',
              started_at: '2026-05-07T00:59:55.000Z',
              finished_at: '2026-05-07T01:00:00.000Z',
              last_error_code: null,
              last_error_message: null,
              diagnostics: [
                {
                  code: 'invalid-trigger-event',
                  message: 'Trigger event is never delivered by this source.',
                  path: 'triggers.on_deploy',
                  file_path: '.shipfox/workflows/deploy.yml',
                  severity: 'error',
                },
                {
                  code: 'unknown-trigger-source',
                  message: 'No connection matches this source slug.',
                  path: 'triggers.on_deploy',
                  file_path: '.shipfox/workflows/deploy.yml',
                  severity: 'warning',
                },
                {
                  code: 're-evaluating-command',
                  message: 'Workflow data is re-executed as shell code.',
                  path: 'jobs.build.steps.0.run',
                  file_path: '.shipfox/workflows/build.yml',
                  severity: 'warning',
                },
              ],
            },
          }),
        ),
      }),
    });

    renderWorkflowsPage();

    expect(await screen.findByText('Workflow definition diagnostics')).toBeInTheDocument();
    const diagnosticsCallout = screen
      .getByText('Workflow definition diagnostics')
      .closest('[data-slot="callout"]');
    if (!(diagnosticsCallout instanceof HTMLElement)) {
      throw new Error('Diagnostics callout was not rendered');
    }
    expect(diagnosticsCallout).toBeInTheDocument();
    // Two groups: the deploy workflow file and the build workflow file.
    expect(within(diagnosticsCallout).getAllByText('.shipfox/workflows/deploy.yml')).toHaveLength(
      1,
    );
    expect(within(diagnosticsCallout).getAllByText('.shipfox/workflows/build.yml')).toHaveLength(1);
    expect(within(diagnosticsCallout).getAllByText('triggers.on_deploy')).toHaveLength(2);
    expect(within(diagnosticsCallout).getAllByText('jobs.build.steps.0.run')).toHaveLength(1);
    const errorRow = within(diagnosticsCallout).getByText(
      'Trigger event is never delivered by this source.',
    );
    const warningRow = within(diagnosticsCallout).getByText(
      'No connection matches this source slug.',
    );
    expect(errorRow).toHaveClass('text-tag-error-text');
    expect(warningRow).not.toHaveClass('text-tag-error-text');
    expect(
      within(diagnosticsCallout).getByText('Error:', {selector: 'span.font-medium'}),
    ).toBeInTheDocument();
    expect(
      within(diagnosticsCallout).getAllByText('Warning:', {selector: 'span.font-medium'}),
    ).toHaveLength(2);
    expect(
      within(diagnosticsCallout).getByText('Workflow data is re-executed as shell code.'),
    ).toBeInTheDocument();
  });

  test('renders definitions without client-side sorting or filtering controls', async () => {
    const deployDefinition = baseDefinitionsDto().definitions[0];
    if (!deployDefinition) throw new Error('Deploy definition fixture is missing');
    configureApiClient({
      fetchImpl: createProjectDetailFetch({
        definitions: jsonResponse(
          definitionsDto({
            definitions: [
              deployDefinition,
              {
                ...deployDefinition,
                id: '77777777-7777-4777-8777-777777777777',
                name: 'Archive artifacts',
                config_path: '.shipfox/workflows/archive.yml',
                updated_at: '2026-05-06T01:00:00.000Z',
              },
            ],
          }),
        ),
      }),
    });

    renderWorkflowsPage();

    const table = await screen.findByRole('table', {name: 'Workflow definitions table'});
    const workflowHeader = within(table).getByRole('columnheader', {name: 'Workflow'});
    const updatedHeader = within(table).getByRole('columnheader', {name: 'Updated'});
    expect(workflowHeader).toHaveTextContent('Workflow');
    expect(updatedHeader).toHaveTextContent('Updated');
    expect(within(workflowHeader).queryByRole('button')).not.toBeInTheDocument();
    expect(within(updatedHeader).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', {name: 'Search workflows'})).not.toBeInTheDocument();
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).getByText('Deploy production')).toBeInTheDocument();
    expect(within(table).getByText('Archive artifacts')).toBeInTheDocument();
  });

  test('renders append navigation inside the definitions panel', async () => {
    configureApiClient({
      fetchImpl: createProjectDetailFetch({
        definitions: jsonResponse(definitionsDto({next_cursor: 'cursor-1'})),
      }),
    });

    renderWorkflowsPage();

    const table = await screen.findByRole('table', {name: 'Workflow definitions table'});
    const panel = table.closest('[data-slot="panel"]');

    expect(panel).not.toBeNull();
    expect(
      within(panel as HTMLElement).getByRole('region', {name: 'Table navigation'}),
    ).toBeInTheDocument();
    expect(
      within(panel as HTMLElement).getByRole('button', {name: 'Load more'}),
    ).toBeInTheDocument();
    expect(within(panel as HTMLElement).getByRole('status')).toHaveTextContent('1 row loaded');
    expect(screen.queryByText('Could not load more workflows.')).not.toBeInTheDocument();
  });

  test('opens and closes the definition drawer from the workflow action', async () => {
    configureApiClient({fetchImpl: createProjectDetailFetch()});

    renderWorkflowsPage();

    const workflowName = (await screen.findAllByText('Deploy production'))[0];
    if (!workflowName) throw new Error('Workflow row was not rendered');
    fireEvent.click(workflowName);

    expect(await screen.findByText('Normalized definition')).toBeInTheDocument();
    expect(screen.getByText((content) => content.includes('"deploy"'))).toBeInTheDocument();

    fireEvent.keyDown(document, {key: 'Escape'});

    await waitFor(() => {
      expect(screen.queryByText('Normalized definition')).not.toBeInTheDocument();
    });
  });

  test('shows the registry packages of the opened definition', async () => {
    configureApiClient({
      fetchImpl: createProjectDetailFetch({
        packageUpdates: jsonResponse({
          updates: [
            {
              kind: 'action',
              package: 'shipfox/slack-thread-digest',
              version: '1.4.2',
              latest: '1.6.0',
              behind: true,
              bump: 'minor',
              capability_change: false,
              steps: ['deploy.0'],
              changelog: [],
            },
          ],
        }),
      }),
    });

    renderWorkflowsPage();

    const workflowName = (await screen.findAllByText('Deploy production'))[0];
    if (!workflowName) throw new Error('Workflow row was not rendered');
    fireEvent.click(workflowName);

    expect(await screen.findByText('Update available: 1.4.2 to 1.6.0')).toBeInTheDocument();
    expect(screen.getByRole('region', {name: 'Packages'})).toBeInTheDocument();
  });

  test('queues a run from a workflow definition', async () => {
    configureApiClient({fetchImpl: createProjectDetailFetch()});

    renderWorkflowsPage();

    const [runButton] = await screen.findAllByRole('button', {name: 'Run'});
    if (!runButton) throw new Error('Run button was not rendered');

    fireEvent.click(runButton);

    expect(await screen.findByText('Run queued')).toBeInTheDocument();
  });

  describe('when the run is refused', () => {
    async function clickRun() {
      const [runButton] = await screen.findAllByRole('button', {name: 'Run'});
      if (!runButton) throw new Error('Run button was not rendered');
      fireEvent.click(runButton);
    }

    function refusedRun(code: string, status: number, details: unknown) {
      return jsonResponse({code, message: `Server message for ${code}`, details}, {status});
    }

    test('shows the missing variable in a row callout with a prefilled create link', async () => {
      configureApiClient({
        fetchImpl: createProjectDetailFetch({
          run: refusedRun('workflow-interpolation-unresolvable', 422, {
            variable_key: 'E2E_SCHEDULE_ENABLED',
            job_key: 'e2e',
            field: 'job.if',
            source: 'vars.E2E_SCHEDULE_ENABLED',
          }),
        }),
      });

      renderWorkflowsPage();
      await clickRun();

      const callout = await screen.findByRole('alert');
      expect(within(callout).getByText('Variable E2E_SCHEDULE_ENABLED is not set')).toBeVisible();
      expect(callout).toHaveTextContent('The if on job e2e reads it.');
      const link = within(callout).getByRole('link', {name: 'Add variable'});
      expect(link).toHaveAttribute('href', expect.stringContaining('/w/acme/settings/variables'));
      expect(link).toHaveAttribute('href', expect.stringContaining('create=E2E_SCHEDULE_ENABLED'));
      expect(callout.closest('tr')).toHaveAttribute('data-row-id', DEFINITION_ID);
      expect(screen.queryByText('Could not queue run.')).not.toBeInTheDocument();
      expect(document.querySelector('[data-sonner-toast]')).not.toBeInTheDocument();
    });

    test('shows the missing secret in a row callout with a prefilled create link', async () => {
      configureApiClient({
        fetchImpl: createProjectDetailFetch({
          run: refusedRun('secret-not-found', 422, {key: 'DEPLOY_TOKEN'}),
        }),
      });

      renderWorkflowsPage();
      await clickRun();

      const callout = await screen.findByRole('alert');
      expect(within(callout).getByText('Secret DEPLOY_TOKEN is not set')).toBeVisible();
      expect(within(callout).getByRole('link', {name: 'Add secret'})).toHaveAttribute(
        'href',
        expect.stringContaining('create=DEPLOY_TOKEN'),
      );
      expect(document.querySelector('[data-sonner-toast]')).not.toBeInTheDocument();
    });

    test('shows the admission refusal with the server-provided action', async () => {
      configureApiClient({
        fetchImpl: createProjectDetailFetch({
          run: refusedRun('admission-denied', 409, {
            workspace_id: PROJECT_TEST_WID,
            reason: 'The monthly run allowance is used up.',
            required_action: {
              reason: 'quota',
              message: 'Run allowance reached',
              url: 'https://billing.example.test/upgrade',
            },
          }),
        }),
      });

      renderWorkflowsPage();
      await clickRun();

      const callout = await screen.findByRole('alert');
      expect(within(callout).getByText('Run allowance reached')).toBeVisible();
      expect(callout).toHaveTextContent('The monthly run allowance is used up.');
      expect(within(callout).getByRole('link', {name: 'Open'})).toHaveAttribute(
        'href',
        'https://billing.example.test/upgrade',
      );
      expect(document.querySelector('[data-sonner-toast]')).not.toBeInTheDocument();
    });

    test('never renders an unknown server message', async () => {
      configureApiClient({
        fetchImpl: createProjectDetailFetch({
          run: refusedRun('something-new', 500, {}),
        }),
      });

      renderWorkflowsPage();
      await clickRun();

      const callout = await screen.findByRole('alert');
      expect(callout).toHaveTextContent('Could not start the run');
      expect(callout).toHaveTextContent('Try again in a moment.');
      expect(callout).not.toHaveTextContent('Server message');
    });

    test('dismisses the callout', async () => {
      configureApiClient({
        fetchImpl: createProjectDetailFetch({
          run: refusedRun('workspace-suspended', 409, {}),
        }),
      });

      renderWorkflowsPage();
      await clickRun();

      fireEvent.click(await screen.findByRole('button', {name: 'Dismiss error'}));

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    test('refreshes the definitions from the changed-workflow action', async () => {
      const fetchImpl = createProjectDetailFetch({
        run: refusedRun('manual-trigger-not-found', 409, {}),
      });
      configureApiClient({fetchImpl});

      renderWorkflowsPage();
      await clickRun();
      const definitionRequests = () =>
        fetchImpl.mock.calls.filter(
          ([input]) => new URL(requestInputUrl(input)).pathname === '/definitions',
        ).length;
      const before = definitionRequests();

      fireEvent.click(await screen.findByRole('button', {name: 'Refresh'}));

      await waitFor(() => expect(definitionRequests()).toBeGreaterThan(before));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  test('renders not found state', async () => {
    configureApiClient({
      fetchImpl: vi.fn((input) => {
        const url = new URL(requestInputUrl(input));
        if (url.pathname === `/projects/${PROJECT_ID}`) {
          return Promise.resolve(jsonResponse({code: 'not-found'}, {status: 404}));
        }
        if (url.pathname === '/integration-connections') {
          return Promise.resolve(jsonResponse(connectionsDto()));
        }
        return Promise.resolve(jsonResponse(definitionsDto()));
      }),
    });

    renderWorkflowsPage();

    expect(await screen.findByText('Project not found')).toBeInTheDocument();
  });
});

function renderWorkflowsPage(chrome: Partial<ChromeSlots> = {}) {
  return renderProjectPage(
    `/w/${PROJECT_TEST_WSLUG}/p/project/workflows`,
    () => <ProjectWorkflowsPage projectId={PROJECT_ID} />,
    chrome,
  );
}

function createProjectDetailFetch({
  project = jsonResponse(projectDto()),
  definitions = jsonResponse(definitionsDto()),
  run = jsonResponse(runDto(), {status: 201}),
  connections = jsonResponse(connectionsDto()),
  packageUpdates = jsonResponse({updates: []}),
}: {
  project?: Response;
  definitions?: Response;
  run?: Response;
  connections?: Response;
  packageUpdates?: Response;
} = {}) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(requestInputUrl(input));
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');

    if (url.pathname === `/projects/${PROJECT_ID}`) {
      return Promise.resolve(project.clone());
    }
    if (url.pathname === '/definitions') {
      return Promise.resolve(definitions.clone());
    }
    if (url.pathname === '/integration-connections') {
      return Promise.resolve(connections.clone());
    }
    if (
      url.pathname ===
      `/workspaces/${PROJECT_TEST_WID}/definitions/${DEFINITION_ID}/package-updates`
    ) {
      return Promise.resolve(packageUpdates.clone());
    }
    if (
      url.pathname.startsWith('/workflow-definitions/') &&
      url.pathname.endsWith('/fire-manual') &&
      method === 'POST'
    ) {
      return Promise.resolve(run.clone());
    }
    return Promise.resolve(jsonResponse({code: 'not-found'}, {status: 404}));
  });
}

function requestInputUrl(input: RequestInfo | URL) {
  if (input instanceof Request) return input.url;
  return String(input);
}

function projectDto() {
  return {
    id: PROJECT_ID,
    workspace_id: PROJECT_TEST_WID,
    name: 'Platform',
    slug: 'platform',
    source: {
      connection_id: CONNECTION_ID,
      external_repository_id: 'platform',
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function connectionsDto() {
  return {
    connections: [
      {
        id: CONNECTION_ID,
        workspace_id: PROJECT_TEST_WID,
        provider: 'github',
        external_account_id: 'acme',
        slug: 'github_acme',
        display_name: 'Acme GitHub',
        lifecycle_status: 'active',
        capabilities: ['source_control'],
        created_at: '2026-05-07T00:00:00.000Z',
        updated_at: '2026-05-07T00:00:00.000Z',
      },
    ],
  };
}

function definitionsDto(
  overrides: Partial<{definitions: unknown[]; next_cursor: string | null; sync: unknown}> = {},
) {
  return {...baseDefinitionsDto(), ...overrides};
}

function baseDefinitionsDto() {
  return {
    definitions: [
      {
        id: DEFINITION_ID,
        project_id: PROJECT_ID,
        config_path: '.shipfox/workflows/deploy.yml',
        source: 'vcs',
        sha: 'abc123',
        ref: 'main',
        name: 'Deploy production',
        workflow_document: {
          name: 'Deploy production',
          triggers: {on_demand: {source: 'manual', event: 'fire'}},
          jobs: {deploy: {steps: [{run: './deploy.sh'}]}},
        },
        workflow_model: {kind: 'workflow', name: 'Deploy production'},
        manual_trigger: {name: 'on_demand'},
        fetched_at: '2026-05-07T01:00:00.000Z',
        created_at: '2026-05-07T01:00:00.000Z',
        updated_at: '2026-05-07T01:00:00.000Z',
      },
    ],
    next_cursor: null,
    sync: {
      ref: 'main',
      status: 'succeeded',
      last_sync_at: '2026-05-07T01:00:00.000Z',
      started_at: '2026-05-07T00:59:55.000Z',
      finished_at: '2026-05-07T01:00:00.000Z',
      last_error_code: null,
      last_error_message: null,
      diagnostics: [],
    },
  };
}

function runDto() {
  return {workflow_run_id: '66666666-6666-4666-8666-666666666666'};
}
