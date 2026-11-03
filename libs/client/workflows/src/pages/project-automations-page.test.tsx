import {configureApiClient} from '@shipfox/client-api';
import type {ChromeSlots} from '@shipfox/client-shell/runtime';
import {act, fireEvent, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {useState} from 'react';
import {
  jsonResponse,
  PROJECT_TEST_WID,
  PROJECT_TEST_WSLUG,
  renderProjectPage,
} from '#test/pages.js';
import {ProjectAutomationsPage} from './project-automations-page.js';

const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const CONNECTION_ID = '33333333-3333-4333-8333-333333333333';
const DEFINITION_ID = '55555555-5555-4555-8555-555555555555';
const LATEST_RUN_ID = '99999999-9999-4999-8999-999999999999';
const HEAD_COMMIT = '3f9a21c0d6e4b8a17c2e5f9d0b3a6c8e1f4d7a20';
const OLD_COMMIT = 'e01b77a9c2d4f6081a3b5c7d9e1f2a4b6c8d0e1f';
const DEPLOY_WORKFLOW_ROW_REGEX = /Deploy production/;
const FAILED_RUN_LINK_REGEX = /Failed/;
const PENDING_RUN_LINK_REGEX = /Pending/;
const PIN_COMMIT_ROW_REGEX = /Pin the deploy action/;
const FILE_HISTORY_LINK_REGEX = /File history, updated/;
const ADDS_THREE_FILES_REGEX = /adds 3 files to/;
const MIRA_IS_MOVING_REGEX = /Mira Okafor is moving this project to/;
const MERGES_REGEX = /once pull request #128 merges/;

describe('ProjectAutomationsPage', () => {
  test('renders the config source above the workflow definitions', async () => {
    configureApiClient({fetchImpl: createProjectDetailFetch()});

    renderAutomationsPage();

    expect((await screen.findAllByText('Deploy production'))[0]).toBeInTheDocument();
    expect(screen.getByRole('heading', {name: 'Automations'})).toHaveClass('sr-only');
    expect(screen.getAllByText('.shipfox/workflows/deploy.yml')[0]).toBeInTheDocument();
    const source = screen.getByRole('region', {name: 'Config source'});
    expect(await within(source).findByText('acme/platform')).toBeInTheDocument();
    expect(within(source).getByText('main')).toBeInTheDocument();
    expect(within(source).getByText('3f9a21c')).toHaveAttribute('title', HEAD_COMMIT);
    expect(within(source).getByText('Synced')).toBeInTheDocument();
    expect(within(source).getByRole('link', {name: 'Open on GitHub'})).toHaveAttribute(
      'href',
      'https://github.com/acme/platform',
    );
    expect(screen.getByRole('link', {name: 'Workflows'})).toHaveAttribute('aria-current', 'page');
    const definitionsRegion = screen.getByRole('region', {name: 'Workflow definitions'});
    expect(
      within(definitionsRegion).getByRole('table', {name: 'Workflow definitions table'}),
    ).toBeInTheDocument();
    expect(screen.getByRole('row', {name: DEPLOY_WORKFLOW_ROW_REGEX})).toHaveAttribute(
      'data-row-id',
      '55555555-5555-4555-8555-555555555555',
    );
  });

  test('keeps the source visible when the head commit cannot be read', async () => {
    configureApiClient({
      fetchImpl: createProjectDetailFetch({config: jsonResponse(configDto({head: null}))}),
    });

    renderAutomationsPage();

    const source = await screen.findByRole('region', {name: 'Config source'});
    expect(await within(source).findByText('acme/platform')).toBeInTheDocument();
    expect(within(source).queryByText('Latest commit')).not.toBeInTheDocument();
  });

  test('lists what starts each workflow', async () => {
    configureApiClient({fetchImpl: createProjectDetailFetch()});

    renderAutomationsPage();

    const row = await screen.findByRole('row', {name: DEPLOY_WORKFLOW_ROW_REGEX});
    const triggers = within(row).getByRole('list', {name: 'Triggers'});
    expect(
      within(triggers)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['manual', 'cron0 3 * * 1-5', 'sentryissue.created']);
  });

  test('shows definitions error while keeping the source header visible', async () => {
    configureApiClient({
      fetchImpl: createProjectDetailFetch({
        definitions: jsonResponse({code: 'server-error'}, {status: 500}),
      }),
    });

    renderAutomationsPage();

    expect(await screen.findByText("Couldn't load workflows")).toBeInTheDocument();
    // The sync badge falls back to Unavailable when definitions errored before providing a sync.
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.getByRole('region', {name: 'Config source'})).toBeInTheDocument();
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

    renderAutomationsPage();

    expect(await screen.findByText('Workflow sync failed')).toBeInTheDocument();
    expect(screen.getAllByText('Workflow definitions are invalid').length).toBeGreaterThan(0);
    expect(screen.getByText('Workflow definition errors')).toBeInTheDocument();
    expect(screen.getByText('.shipfox/workflows/invalid.yml')).toHaveClass('break-all');
    expect(screen.getByRole('link', {name: '.shipfox/workflows/invalid.yml'})).toHaveAttribute(
      'href',
      `/w/${PROJECT_TEST_WSLUG}/p/project/automations/files/.shipfox/workflows/invalid.yml`,
    );
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

    renderAutomationsPage();

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

    renderAutomationsPage();

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

      renderAutomationsPage({FirstWorkflowPanel});

      expect(await screen.findByText(`First workflow panel for ${PROJECT_ID}`)).toBeInTheDocument();
      expect(screen.getByRole('region', {name: 'Config source'})).toBeInTheDocument();
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

      renderAutomationsPage({FirstWorkflowPanel});

      expect(await screen.findByText(`First workflow panel for ${PROJECT_ID}`)).toBeInTheDocument();
      expect(screen.getByText('Workflow sync failed')).toBeInTheDocument();
    });

    test('does not render the slot when the project has definitions', async () => {
      configureApiClient({fetchImpl: createProjectDetailFetch()});

      renderAutomationsPage({FirstWorkflowPanel});

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

      renderAutomationsPage({FirstWorkflowPanel});

      expect(await screen.findByText('No workflows')).toBeInTheDocument();
      expect(screen.queryByText(`First workflow panel for ${PROJECT_ID}`)).not.toBeInTheDocument();
    });

    test('does not render the slot when definitions fail to load', async () => {
      configureApiClient({
        fetchImpl: createProjectDetailFetch({
          definitions: jsonResponse({code: 'server-error'}, {status: 500}),
        }),
      });

      renderAutomationsPage({FirstWorkflowPanel});

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
            <ProjectAutomationsPage
              projectId={projectId}
              workspaceSlug={PROJECT_TEST_WSLUG}
              projectSlug="project"
            />
          </>
        );
      }
      renderProjectPage(`/w/${PROJECT_TEST_WSLUG}/p/project/automations`, () => <SwitchingPage />, {
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
      // The new project loads from scratch instead of showing the previous project's rows.
      expect(await screen.findByRole('textbox', {name: 'Search workflows'})).toBeDisabled();
      expect(screen.queryByText(`First workflow panel for ${PROJECT_ID}`)).not.toBeInTheDocument();
    });

    test('renders only the empty state when the slot is absent', async () => {
      configureApiClient({
        fetchImpl: createProjectDetailFetch({definitions: emptyDefinitions('succeeded')}),
      });

      renderAutomationsPage();

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

    renderAutomationsPage();

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

    renderAutomationsPage();

    const title = await screen.findByText('Workflow definition errors');
    const callout = title.closest('[data-slot="callout"]');
    if (!(callout instanceof HTMLElement)) throw new Error('Diagnostics callout was not rendered');
    const group = within(callout).getByText('.shipfox/actions/thread/action.yml').closest('li');
    if (!(group instanceof HTMLElement)) throw new Error('File group was not rendered');
    expect(within(group).getByText('main')).toBeInTheDocument();
    expect(group).toHaveTextContent(
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

    renderAutomationsPage();

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

  describe('last run column', () => {
    test("links a workflow's latest synced run with its status", async () => {
      configureApiClient({
        fetchImpl: createProjectDetailFetch({
          latestRuns: jsonResponse({runs: [latestRunDto({status: 'failed'})]}),
        }),
      });

      renderAutomationsPage();

      const row = await screen.findByRole('row', {name: DEPLOY_WORKFLOW_ROW_REGEX});
      const link = await within(row).findByRole('link', {name: FAILED_RUN_LINK_REGEX});
      expect(link).toHaveAttribute(
        'href',
        `/w/${PROJECT_TEST_WSLUG}/p/project/runs/${LATEST_RUN_ID}`,
      );
      expect(within(link).getByRole('img', {name: 'Failed'})).toBeInTheDocument();
      expect(within(row).queryByText('No runs yet')).not.toBeInTheDocument();
    });

    test('says so when a workflow has no synced run yet', async () => {
      configureApiClient({fetchImpl: createProjectDetailFetch()});

      renderAutomationsPage();

      const row = await screen.findByRole('row', {name: DEPLOY_WORKFLOW_ROW_REGEX});
      expect(await within(row).findByText('No runs yet')).toBeInTheDocument();
    });

    test('keeps the workflows listed when the runs cannot be read', async () => {
      configureApiClient({
        fetchImpl: createProjectDetailFetch({
          latestRuns: jsonResponse({code: 'server-error'}, {status: 500}),
        }),
      });

      renderAutomationsPage();

      const row = await screen.findByRole('row', {name: DEPLOY_WORKFLOW_ROW_REGEX});
      expect(await within(row).findByText('Unavailable')).toBeInTheDocument();
      expect(within(row).queryByText('No runs yet')).not.toBeInTheDocument();
    });

    const ARCHIVE_ID = '77777777-7777-4777-8777-777777777777';

    function twoPageFetch() {
      const deployDefinition = baseDefinitionsDto().definitions[0];
      if (!deployDefinition) throw new Error('Deploy definition fixture is missing');
      const archiveDefinition = {
        ...deployDefinition,
        id: ARCHIVE_ID,
        name: 'Archive artifacts',
        config_path: '.shipfox/workflows/archive.yml',
      };
      return createProjectDetailFetch({
        definitions: jsonResponse(definitionsDto({next_cursor: 'cursor-1'})),
        definitionsAfterCursor: jsonResponse(
          definitionsDto({definitions: [archiveDefinition], next_cursor: null}),
        ),
      });
    }

    test('fails only the rows of the page whose runs could not be read', async () => {
      const detailFetch = twoPageFetch();
      configureApiClient({
        fetchImpl: vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(requestInputUrl(input));
          if (
            url.pathname === '/workflows/runs/latest' &&
            url.searchParams.get('definition_ids') === ARCHIVE_ID
          ) {
            return Promise.resolve(jsonResponse({code: 'server-error'}, {status: 500}));
          }
          return detailFetch(input, init);
        }),
      });

      renderAutomationsPage();

      const table = await screen.findByRole('table', {name: 'Workflow definitions table'});
      expect(await within(table).findByText('Unavailable')).toBeInTheDocument();
      expect(await within(table).findByText('No runs yet')).toBeInTheDocument();
    });

    test('shows the run a manual launch just created', async () => {
      const detailFetch = createProjectDetailFetch();
      let launched = false;
      configureApiClient({
        fetchImpl: vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(requestInputUrl(input));
          if (url.pathname.endsWith('/fire-manual')) launched = true;
          if (url.pathname === '/workflows/runs/latest') {
            return Promise.resolve(
              jsonResponse({runs: launched ? [latestRunDto({status: 'pending'})] : []}),
            );
          }
          return detailFetch(input, init);
        }),
      });

      renderAutomationsPage();

      const [runButton] = await screen.findAllByRole('button', {name: 'Run'});
      if (!runButton) throw new Error('Run button was not rendered');
      expect(await screen.findByText('No runs yet')).toBeInTheDocument();
      fireEvent.click(runButton);

      expect(await screen.findByRole('link', {name: PENDING_RUN_LINK_REGEX})).toBeInTheDocument();
    });

    test('reads the latest runs once for each page of definitions', async () => {
      const fetchImpl = twoPageFetch();
      configureApiClient({fetchImpl});

      renderAutomationsPage();

      const table = await screen.findByRole('table', {name: 'Workflow definitions table'});
      await waitFor(() => expect(within(table).getAllByText('No runs yet')).toHaveLength(2));
      const latestRunRequests = fetchImpl.mock.calls
        .map(([input]) => new URL(requestInputUrl(input)))
        .filter((url) => url.pathname === '/workflows/runs/latest');
      expect(latestRunRequests.map((url) => url.searchParams.get('definition_ids'))).toEqual([
        DEFINITION_ID,
        ARCHIVE_ID,
      ]);
    });
  });

  test('searches every workflow once all pages have loaded', async () => {
    const deployDefinition = baseDefinitionsDto().definitions[0];
    if (!deployDefinition) throw new Error('Deploy definition fixture is missing');
    const archiveDefinition = {
      ...deployDefinition,
      id: '77777777-7777-4777-8777-777777777777',
      name: 'Archive artifacts',
      config_path: '.shipfox/workflows/archive.yml',
      workflow_model: {kind: 'workflow', name: 'Archive artifacts', triggers: []},
      manual_trigger: null,
    };
    configureApiClient({
      fetchImpl: createProjectDetailFetch({
        definitions: jsonResponse(definitionsDto({next_cursor: 'cursor-1'})),
        definitionsAfterCursor: jsonResponse(
          definitionsDto({definitions: [archiveDefinition], next_cursor: null}),
        ),
      }),
    });

    renderAutomationsPage();

    const table = await screen.findByRole('table', {name: 'Workflow definitions table'});
    expect(await within(table).findByText('Archive artifacts')).toBeInTheDocument();
    expect(await screen.findByText('2 workflows')).toBeInTheDocument();
    expect(screen.queryByRole('region', {name: 'Table navigation'})).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', {name: 'Search workflows'}), {
      target: {value: 'archive'},
    });

    expect(within(table).queryByText('Deploy production')).not.toBeInTheDocument();
    expect(within(table).getByText('Archive artifacts')).toBeInTheDocument();
    expect(screen.getByText('1 workflow')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', {name: 'Search workflows'}), {
      target: {value: 'nothing matches'},
    });
    fireEvent.click(await screen.findByRole('button', {name: 'Show all workflows'}));

    expect(within(table).getByText('Deploy production')).toBeInTheDocument();
    expect(screen.getByText('2 workflows')).toBeInTheDocument();
  });

  test('keeps search off and offers a retry when a later page fails', async () => {
    configureApiClient({
      fetchImpl: createProjectDetailFetch({
        definitions: jsonResponse(definitionsDto({next_cursor: 'cursor-1'})),
        definitionsAfterCursor: jsonResponse({code: 'server-error'}, {status: 500}),
      }),
    });

    renderAutomationsPage();

    const table = await screen.findByRole('table', {name: 'Workflow definitions table'});
    const panel = table.closest('[data-slot="panel"]') as HTMLElement;
    expect(await within(panel).findByRole('button', {name: 'Retry'})).toBeInTheDocument();
    expect(within(panel).getByRole('region', {name: 'Table navigation'})).toBeInTheDocument();
    expect(screen.getByRole('textbox', {name: 'Search workflows'})).toBeDisabled();
  });

  test('opens and closes the definition drawer from the workflow action', async () => {
    configureApiClient({fetchImpl: createProjectDetailFetch()});

    renderAutomationsPage();

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

    renderAutomationsPage();

    const workflowName = (await screen.findAllByText('Deploy production'))[0];
    if (!workflowName) throw new Error('Workflow row was not rendered');
    fireEvent.click(workflowName);

    expect(await screen.findByText('Update available: 1.4.2 to 1.6.0')).toBeInTheDocument();
    expect(screen.getByRole('region', {name: 'Packages'})).toBeInTheDocument();
  });

  test('queues a run from a workflow definition', async () => {
    configureApiClient({fetchImpl: createProjectDetailFetch()});

    renderAutomationsPage();

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

      renderAutomationsPage();
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

      renderAutomationsPage();
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

      renderAutomationsPage();
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

      renderAutomationsPage();
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

      renderAutomationsPage();
      await clickRun();

      fireEvent.click(await screen.findByRole('button', {name: 'Dismiss error'}));

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    test('refreshes the definitions from the changed-workflow action', async () => {
      const fetchImpl = createProjectDetailFetch({
        run: refusedRun('manual-trigger-not-found', 409, {}),
      });
      configureApiClient({fetchImpl});

      renderAutomationsPage();
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

  describe('Files tab', () => {
    test('browses .shipfox and reads a file by keyboard, then opens its history', async () => {
      const fetchImpl = createProjectDetailFetch();
      configureApiClient({fetchImpl});
      const user = userEvent.setup();

      renderFilesPage();

      const tree = await screen.findByRole('tree', {name: 'Config files'});
      expect(screen.getByRole('link', {name: 'Files'})).toHaveAttribute('aria-current', 'page');
      expect(screen.getByText('Select a file')).toBeInTheDocument();
      // The tree is one tab stop, on its first node until something is selected.
      const tabStops = within(tree)
        .getAllByRole('treeitem')
        .filter((item) => item.tabIndex === 0);
      expect(tabStops.map((item) => item.dataset.path)).toEqual(['.shipfox']);
      act(() => tabStops[0]?.focus());
      await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}');
      expect(within(tree).getByRole('treeitem', {name: 'deploy.yml'})).toHaveFocus();
      await user.keyboard('{Enter}');

      const file = await screen.findByRole('region', {name: 'Config file'});
      expect(await within(file).findByText('Used by workflow')).toHaveTextContent(
        'Used by workflow Deploy production',
      );
      // Highlighting splits a line into tokens once it loads, so match the text, not a node.
      await waitFor(() => expect(file).toHaveTextContent('name: Deploy production'));
      expect(within(tree).getByRole('treeitem', {name: 'deploy.yml'})).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(commitRequests(fetchImpl)).toHaveLength(0);

      await user.click(within(file).getByRole('link', {name: 'History'}));

      const history = await within(file).findByRole('list', {
        name: 'History of .shipfox/workflows/deploy.yml',
      });
      const row = within(history).getByRole('link', {name: PIN_COMMIT_ROW_REGEX});
      expect(row).toHaveAttribute('href', `https://github.com/acme/platform/commit/${OLD_COMMIT}`);
      expect(row).toHaveTextContent('e01b77a');
      expect(row).toHaveTextContent('Mira Okafor');
      expect(within(file).getByRole('link', {name: 'History'})).toHaveAttribute(
        'aria-current',
        'page',
      );
      expect(commitRequests(fetchImpl)[0]?.searchParams.get('path')).toBe(
        '.shipfox/workflows/deploy.yml',
      );
      expect(commitRequests(fetchImpl)[0]?.searchParams.get('ref')).toBe(HEAD_COMMIT);
    });

    test('lists every config change when .shipfox is selected', async () => {
      configureApiClient({fetchImpl: createProjectDetailFetch()});

      renderFilesPage('.shipfox');

      const history = await screen.findByRole('list', {name: 'History of .shipfox'});
      expect(within(history).getAllByRole('listitem')).toHaveLength(1);
      expect(screen.queryByRole('navigation', {name: 'File view'})).not.toBeInTheDocument();
    });

    test('shows plain rows for commits with no page of their own', async () => {
      configureApiClient({
        fetchImpl: createProjectDetailFetch({
          commits: jsonResponse(commitsDto({html_url: undefined})),
        }),
      });

      renderFilesPage('.shipfox');

      const history = await screen.findByRole('list', {name: 'History of .shipfox'});
      expect(within(history).getByText('Pin the deploy action')).toBeInTheDocument();
      expect(within(history).queryByRole('link')).not.toBeInTheDocument();
    });

    test('hides History when the provider has no commit list', async () => {
      const fetchImpl = createProjectDetailFetch({
        config: jsonResponse({...configDto(), history_supported: false}),
      });
      configureApiClient({fetchImpl});

      renderFilesPage('.shipfox/workflows/deploy.yml', {view: 'history'});

      const file = await screen.findByRole('region', {name: 'Config file'});
      await waitFor(() => expect(file).toHaveTextContent('name: Deploy production'));
      expect(screen.queryByRole('link', {name: 'History'})).not.toBeInTheDocument();
      expect(commitRequests(fetchImpl)).toHaveLength(0);
    });

    test.each([
      {
        name: 'a symbolic link',
        path: '.shipfox/prompts/shared.md',
        title: 'Symbolic link',
      },
      {
        name: 'a submodule',
        path: '.shipfox/actions/vendor',
        title: 'Submodule',
      },
    ])('shows $name without reading it', async ({path, title}) => {
      const fetchImpl = createProjectDetailFetch();
      configureApiClient({fetchImpl});

      renderFilesPage(path);

      expect(await screen.findByText(title)).toBeInTheDocument();
      expect(fileReadRequests(fetchImpl)).toHaveLength(0);
    });

    test.each([
      {code: 'content-too-large', status: 422, title: 'File too large to show'},
      {code: 'binary-file-unsupported', status: 422, title: 'Not a text file'},
      {code: 'access-denied', status: 422, title: "Couldn't read this file"},
    ])('shows "$title" when the read answers $code', async ({code, status, title}) => {
      configureApiClient({
        fetchImpl: createProjectDetailFetch({
          fileRead: jsonResponse({code, message: code}, {status}),
        }),
      });

      renderFilesPage('.shipfox/workflows/deploy.yml');

      expect(await screen.findByText(title)).toBeInTheDocument();
    });

    test('keeps the source header when the files cannot be listed', async () => {
      configureApiClient({
        fetchImpl: createProjectDetailFetch({
          files: jsonResponse({code: 'integration-connection-inactive'}, {status: 422}),
        }),
      });

      renderFilesPage();

      expect(await screen.findByText("Couldn't load config files")).toBeInTheDocument();
      expect(screen.getByRole('region', {name: 'Config source'})).toBeInTheDocument();
    });
  });

  test('links each workflow to its file and its history', async () => {
    configureApiClient({fetchImpl: createProjectDetailFetch()});

    renderAutomationsPage();

    const row = await screen.findByRole('row', {name: DEPLOY_WORKFLOW_ROW_REGEX});
    expect(within(row).getByRole('link', {name: 'View file'})).toHaveAttribute(
      'href',
      `/w/${PROJECT_TEST_WSLUG}/p/project/automations/files/.shipfox/workflows/deploy.yml`,
    );
    expect(within(row).getByRole('link', {name: FILE_HISTORY_LINK_REGEX})).toHaveAttribute(
      'href',
      `/w/${PROJECT_TEST_WSLUG}/p/project/automations/files/.shipfox/workflows/deploy.yml?view=history`,
    );
  });

  describe('moving a managed project', () => {
    test('checks a repository on selection and moves once the member confirms', async () => {
      const flow = createMoveFlow();
      configureApiClient({fetchImpl: createProjectDetailFetch({route: flow.route})});
      const user = userEvent.setup();

      renderAutomationsPage();

      await user.click(await screen.findByRole('button', {name: 'Move to your repository'}));
      const dialog = await screen.findByRole('dialog');
      const legacy = await within(dialog).findByRole('radio', {name: 'acme/legacy main · Private'});
      expect(within(dialog).queryByRole('radio', {checked: true})).not.toBeInTheDocument();
      expect(within(dialog).getByRole('button', {name: 'Continue'})).toBeDisabled();

      await user.click(legacy);

      const refusal = await within(dialog).findByRole('alert');
      expect(refusal).toHaveTextContent('Repository already has config');
      expect(refusal).toHaveTextContent('acme/legacy already has a .shipfox/ directory');
      await waitFor(() => expect(refusal.contains(document.activeElement)).toBe(true));
      expect(legacy).toBeChecked();
      expect(within(dialog).getByRole('button', {name: 'Continue'})).toBeDisabled();

      await user.click(within(dialog).getByRole('radio', {name: 'acme/payments main · Public'}));
      const continueButton = within(dialog).getByRole('button', {name: 'Continue'});
      await waitFor(() => expect(continueButton).toBeEnabled());
      expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
      await user.click(continueButton);

      const changes = within(dialog).getByRole('list', {name: 'What changes'});
      expect(within(dialog).getByText(ADDS_THREE_FILES_REGEX)).toBeInTheDocument();
      expect(changes).toHaveTextContent('The repository is public, so anyone can read it.');
      await user.click(within(dialog).getByRole('button', {name: 'Move to acme/payments'}));

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      const source = screen.getByRole('region', {name: 'Config source'});
      expect(
        await within(source).findByText('Merge pull request #128 to finish moving your config'),
      ).toBeInTheDocument();
      expect(within(source).getByText('Waiting for merge')).toBeInTheDocument();
      expect(flow.linkBodies).toEqual([
        {connection_id: CONNECTION_ID, external_repository_id: '111', dry_run: true},
        {connection_id: CONNECTION_ID, external_repository_id: '918273645', dry_run: true},
        {connection_id: CONNECTION_ID, external_repository_id: '918273645', dry_run: false},
      ]);
    });

    test('offers a retry when the repositories fail to load', async () => {
      configureApiClient({
        fetchImpl: createProjectDetailFetch({
          config: jsonResponse(managedConfigDto()),
          route: ({url}) => {
            if (url.pathname === '/integration-connections') {
              return jsonResponse({connections: [connectionDto()]});
            }
            if (url.pathname === `/integration-connections/${CONNECTION_ID}/repositories`) {
              return jsonResponse({code: 'provider-unavailable'}, {status: 503});
            }
            return undefined;
          },
        }),
      });
      const user = userEvent.setup();

      renderAutomationsPage();
      await user.click(await screen.findByRole('button', {name: 'Move to your repository'}));

      const dialog = await screen.findByRole('dialog');
      expect(await within(dialog).findByText("Couldn't load repositories")).toBeInTheDocument();
      expect(
        within(dialog).getByRole('button', {name: 'Retry loading repositories'}),
      ).toBeEnabled();
    });

    test('links to Integrations when the workspace has no source control connection', async () => {
      configureApiClient({
        fetchImpl: createProjectDetailFetch({
          config: jsonResponse(managedConfigDto()),
          route: ({url}) =>
            url.pathname === '/integration-connections'
              ? jsonResponse({connections: []})
              : undefined,
        }),
      });
      const user = userEvent.setup();

      renderAutomationsPage();
      await user.click(await screen.findByRole('button', {name: 'Move to your repository'}));

      const dialog = await screen.findByRole('dialog');
      expect(await within(dialog).findByRole('link', {name: 'Go to Integrations'})).toHaveAttribute(
        'href',
        `/w/${PROJECT_TEST_WSLUG}/integrations`,
      );
    });

    test('shows a second member who is moving the project, not Retry', async () => {
      configureApiClient({
        fetchImpl: createProjectDetailFetch({
          config: jsonResponse(managedConfigDto({move: moveDto({startedAgoMs: 20_000})})),
          route: ({url}) =>
            url.pathname === `/workspaces/${PROJECT_TEST_WID}/members`
              ? jsonResponse({
                  members: [
                    {
                      id: '88888888-8888-4888-8888-888888888888',
                      user_id: MOVER_ID,
                      workspace_id: PROJECT_TEST_WID,
                      user_email: 'mira@example.com',
                      user_name: 'Mira Okafor',
                      created_at: '2026-05-07T01:00:00.000Z',
                      updated_at: '2026-05-07T01:00:00.000Z',
                    },
                  ],
                })
              : undefined,
        }),
      });

      renderAutomationsPage();

      const source = await screen.findByRole('region', {name: 'Config source'});
      expect(await within(source).findByText(MIRA_IS_MOVING_REGEX)).toBeInTheDocument();
      expect(within(source).getByText('acme/payments')).toBeInTheDocument();
      expect(within(source).getByText('Moving')).toBeInTheDocument();
      expect(within(source).queryByRole('button', {name: 'Retry'})).not.toBeInTheDocument();
      expect(
        within(source).queryByRole('button', {name: 'Move to your repository'}),
      ).not.toBeInTheDocument();
    });

    test('retries a stopped move with its stored target', async () => {
      const linkBodies: unknown[] = [];
      configureApiClient({
        fetchImpl: createProjectDetailFetch({
          config: jsonResponse(managedConfigDto({move: moveDto({startedAgoMs: 10 * 60_000})})),
          route: ({url, method, body}) => {
            if (url.pathname !== `/projects/${PROJECT_ID}/config/link` || method !== 'POST') {
              return undefined;
            }
            linkBodies.push(body);
            return jsonResponse(
              {code: 'move-unconfirmed', message: 'We could not confirm the move.'},
              {status: 503},
            );
          },
        }),
      });
      const user = userEvent.setup();

      renderAutomationsPage();

      const source = await screen.findByRole('region', {name: 'Config source'});
      expect(await within(source).findByText("We couldn't confirm the move")).toBeInTheDocument();
      expect(within(source).getByText('Move stopped')).toBeInTheDocument();
      await user.click(within(source).getByRole('button', {name: 'Retry'}));

      const alert = await within(source).findByRole('alert');
      expect(alert).toHaveTextContent('A retry never opens a second pull request.');
      await waitFor(() => expect(alert.contains(document.activeElement)).toBe(true));
      expect(linkBodies).toEqual([
        {connection_id: CONNECTION_ID, external_repository_id: '918273645', dry_run: false},
      ]);
    });

    test('shows the open pull request instead of the expected sync failure', async () => {
      configureApiClient({
        fetchImpl: createProjectDetailFetch({
          config: jsonResponse(movedConfigDto('open')),
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

      renderAutomationsPage();

      const source = await screen.findByRole('region', {name: 'Config source'});
      expect(await within(source).findByText('Waiting for merge')).toBeInTheDocument();
      expect(within(source).getByRole('link', {name: 'Open pull request'})).toHaveAttribute(
        'href',
        PULL_REQUEST_URL,
      );
      expect((await screen.findAllByText('Deploy production'))[0]).toBeInTheDocument();
      expect(screen.queryByText('Workflow sync failed')).not.toBeInTheDocument();
    });

    test('explains the empty Files tab while the pull request waits', async () => {
      configureApiClient({
        fetchImpl: createProjectDetailFetch({
          config: jsonResponse(movedConfigDto('open')),
          files: jsonResponse({commit: HEAD_COMMIT, files: [], next_cursor: null}),
        }),
      });

      renderFilesPage();

      expect(await screen.findByText('Files appear after the merge')).toBeInTheDocument();
      expect(screen.getByText(MERGES_REGEX)).toBeInTheDocument();
    });

    test('says how config changes on a managed project', async () => {
      configureApiClient({
        fetchImpl: createProjectDetailFetch({config: jsonResponse(managedConfigDto())}),
      });

      renderFilesPage();

      expect(
        await screen.findByText(
          'Config changes through the project agent, or a coding agent with the Shipfox MCP server.',
        ),
      ).toBeInTheDocument();
    });

    test('opens a new pull request after the previous one closed', async () => {
      let reopened = false;
      configureApiClient({
        fetchImpl: createProjectDetailFetch({
          route: ({url, method}) => {
            if (url.pathname === `/projects/${PROJECT_ID}/config`) {
              return jsonResponse(movedConfigDto(reopened ? 'open' : 'closed'));
            }
            if (
              url.pathname === `/projects/${PROJECT_ID}/config/link/pull-request` &&
              method === 'POST'
            ) {
              reopened = true;
              return jsonResponse({
                pull_request: {url: PULL_REQUEST_URL, number: 129, state: 'open'},
              });
            }
            return undefined;
          },
        }),
      });
      const user = userEvent.setup();

      renderAutomationsPage();

      const source = await screen.findByRole('region', {name: 'Config source'});
      expect(
        await within(source).findByText('Pull request #128 was closed without merging'),
      ).toBeInTheDocument();
      await user.click(within(source).getByRole('button', {name: 'Open a new pull request'}));

      expect(await within(source).findByText('Waiting for merge')).toBeInTheDocument();
      expect(reopened).toBe(true);
    });
  });

  test('renders not found state', async () => {
    configureApiClient({
      fetchImpl: vi.fn((input) => {
        const url = new URL(requestInputUrl(input));
        if (url.pathname === `/projects/${PROJECT_ID}`) {
          return Promise.resolve(jsonResponse({code: 'not-found'}, {status: 404}));
        }
        return Promise.resolve(jsonResponse(definitionsDto()));
      }),
    });

    renderAutomationsPage();

    expect(await screen.findByText('Project not found')).toBeInTheDocument();
  });
});

function renderAutomationsPage(chrome: Partial<ChromeSlots> = {}) {
  return renderProjectPage(
    `/w/${PROJECT_TEST_WSLUG}/p/project/automations`,
    () => (
      <ProjectAutomationsPage
        projectId={PROJECT_ID}
        workspaceSlug={PROJECT_TEST_WSLUG}
        projectSlug="project"
      />
    ),
    chrome,
  );
}

function renderFilesPage(path?: string, search: {view?: 'history'} = {}) {
  const query = search.view ? `?view=${search.view}` : '';
  return renderProjectPage(
    `/w/${PROJECT_TEST_WSLUG}/p/project/automations/files/${path ?? ''}${query}`,
    (params) => (
      <ProjectAutomationsPage
        projectId={PROJECT_ID}
        workspaceSlug={PROJECT_TEST_WSLUG}
        projectSlug="project"
        tab={{
          kind: 'files',
          path: params.path || null,
          view: 'view' in params.search && params.search.view === 'history' ? 'history' : 'code',
        }}
      />
    ),
  );
}

function requestsTo(fetchImpl: ReturnType<typeof createProjectDetailFetch>, prefix: string) {
  return fetchImpl.mock.calls
    .map(([input]) => new URL(requestInputUrl(input)))
    .filter((url) => url.pathname.startsWith(`/projects/${PROJECT_ID}${prefix}`));
}

function commitRequests(fetchImpl: ReturnType<typeof createProjectDetailFetch>) {
  return requestsTo(fetchImpl, '/config/commits');
}

function fileReadRequests(fetchImpl: ReturnType<typeof createProjectDetailFetch>) {
  return requestsTo(fetchImpl, '/config/files/');
}

function filesDto() {
  return {
    commit: HEAD_COMMIT,
    files: [
      {path: '.shipfox/actions/vendor', type: 'submodule', size: 0},
      {path: '.shipfox/prompts/shared.md', type: 'symlink', size: 9},
      {path: '.shipfox/workflows/deploy.yml', type: 'file', size: 64},
    ],
    next_cursor: null,
  };
}

function commitsDto(overrides: {html_url?: string | undefined} = {}) {
  const htmlUrl =
    'html_url' in overrides
      ? overrides.html_url
      : `https://github.com/acme/platform/commit/${OLD_COMMIT}`;
  return {
    commit: HEAD_COMMIT,
    commits: [
      {
        oid: OLD_COMMIT,
        message: 'Pin the deploy action\n\nThe tag moved under us.',
        author_name: 'Mira Okafor',
        authored_at: '2026-05-06T01:00:00.000Z',
        ...(htmlUrl ? {html_url: htmlUrl} : {}),
      },
    ],
    next_cursor: null,
  };
}

function createProjectDetailFetch({
  project = jsonResponse(projectDto()),
  config = jsonResponse(configDto()),
  files = jsonResponse(filesDto()),
  fileRead = jsonResponse({
    path: '.shipfox/workflows/deploy.yml',
    commit: HEAD_COMMIT,
    content: 'name: Deploy production\njobs: {}\n',
  }),
  commits = jsonResponse(commitsDto()),
  definitions = jsonResponse(definitionsDto()),
  definitionsAfterCursor,
  run = jsonResponse(runDto(), {status: 201}),
  packageUpdates = jsonResponse({updates: []}),
  latestRuns = jsonResponse({runs: []}),
  route,
}: {
  project?: Response;
  config?: Response;
  definitions?: Response;
  /** The page after the first, when `definitions` returns a cursor. */
  definitionsAfterCursor?: Response;
  run?: Response;
  packageUpdates?: Response;
  latestRuns?: Response;
  files?: Response;
  fileRead?: Response;
  commits?: Response;
  /** Answers a request before the defaults, or returns undefined to fall through to them. */
  route?: (request: {url: URL; method: string; body: unknown}) => Response | undefined;
} = {}) {
  const responsesByPath: Record<string, Response> = {
    [`/projects/${PROJECT_ID}`]: project,
    [`/projects/${PROJECT_ID}/config`]: config,
    '/workflows/runs/latest': latestRuns,
    [`/projects/${PROJECT_ID}/config/files`]: files,
    [`/projects/${PROJECT_ID}/config/commits`]: commits,
    [`/workspaces/${PROJECT_TEST_WID}/definitions/${DEFINITION_ID}/package-updates`]:
      packageUpdates,
  };
  function respond(url: URL, method: string): Response {
    const response = responsesByPath[url.pathname];
    if (response) return response;
    if (url.pathname.startsWith(`/projects/${PROJECT_ID}/config/files/`)) return fileRead;
    if (url.pathname === '/definitions') {
      return url.searchParams.has('cursor') && definitionsAfterCursor
        ? definitionsAfterCursor
        : definitions;
    }
    if (url.pathname.endsWith('/fire-manual') && method === 'POST') return run;
    return jsonResponse({code: 'not-found'}, {status: 404});
  }

  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(requestInputUrl(input));
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const routed = route?.({url, method, body: await requestBody(input)});
    return (routed ?? respond(url, method)).clone();
  });
}

function latestRunDto(overrides: Partial<{status: string}> = {}) {
  return {
    id: LATEST_RUN_ID,
    definition_id: DEFINITION_ID,
    number: 3,
    status: 'succeeded',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

/** The API client passes a `Request`, whose JSON body is read from a clone. */
async function requestBody(input: RequestInfo | URL): Promise<unknown> {
  if (!(input instanceof Request)) return undefined;
  const text = await input.clone().text();
  return text ? JSON.parse(text) : undefined;
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
      kind: 'linked',
      connection_id: CONNECTION_ID,
      external_repository_id: 'platform',
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function configDto(overrides: Record<string, unknown> = {}) {
  return {
    source: {
      kind: 'linked',
      provider: 'github',
      connection_id: CONNECTION_ID,
      external_repository_id: 'platform',
      owner: 'acme',
      name: 'platform',
      default_branch: 'main',
    },
    head: {ref: 'refs/heads/main', commit: HEAD_COMMIT},
    history_supported: true,
    move: null,
    pull_request: null,
    ...overrides,
  };
}

const MANAGED_REPOSITORY_ID = 'managed:8b1f0c2e-5d7a-4c3b-9e6f-1a2b3c4d5e6f';
const MANAGED_CONNECTION_ID = '22222222-2222-4222-8222-222222222222';
const MOVER_ID = '77777777-7777-4777-8777-777777777777';
const PULL_REQUEST_URL = 'https://github.com/acme/payments/pull/128';

function managedConfigDto(overrides: Record<string, unknown> = {}) {
  return configDto({
    source: {
      kind: 'managed',
      provider: 'managed',
      connection_id: MANAGED_CONNECTION_ID,
      external_repository_id: MANAGED_REPOSITORY_ID,
      owner: null,
      name: null,
      default_branch: 'main',
    },
    ...overrides,
  });
}

function moveDto({startedAgoMs}: {startedAgoMs: number}) {
  return {
    status: 'linking',
    target: {
      connection_id: CONNECTION_ID,
      external_repository_id: '918273645',
      full_name: 'acme/payments',
    },
    started_by: MOVER_ID,
    started_at: new Date(Date.now() - startedAgoMs).toISOString(),
  };
}

function movedConfigDto(state: 'open' | 'closed' | 'unknown') {
  return configDto({
    source: {
      kind: 'linked',
      provider: 'github',
      connection_id: CONNECTION_ID,
      external_repository_id: '918273645',
      owner: 'acme',
      name: 'payments',
      default_branch: 'main',
    },
    move: {
      ...moveDto({startedAgoMs: 60_000}),
      status: 'linked',
      target: {...moveDto({startedAgoMs: 0}).target, full_name: null},
    },
    pull_request: {url: PULL_REQUEST_URL, number: 128, state},
  });
}

/**
 * A managed project with one GitHub connection and two repositories: `acme/legacy` already has
 * config, and `acme/payments` passes. A confirmed move turns the config into an open pull request.
 */
function createMoveFlow() {
  let moved = false;
  const linkBodies: unknown[] = [];
  const fixed: Record<string, () => Response> = {
    [`/projects/${PROJECT_ID}/config`]: () =>
      jsonResponse(moved ? movedConfigDto('open') : managedConfigDto()),
    '/integration-connections': () => jsonResponse({connections: [connectionDto()]}),
    [`/integration-connections/${CONNECTION_ID}/repositories`]: () =>
      jsonResponse({
        repositories: [
          repositoryDto('legacy', '111'),
          repositoryDto('payments', '918273645', 'public'),
        ],
        next_cursor: null,
      }),
  };

  function link(body: {external_repository_id: string; dry_run: boolean}): Response {
    linkBodies.push(body);
    const {external_repository_id: target, dry_run: dryRun} = body;
    if (target === '111') {
      return jsonResponse(
        {code: 'config-exists', message: 'The repository already has config'},
        {status: 409},
      );
    }
    if (!dryRun) moved = true;
    return jsonResponse({
      status: dryRun ? 'ready' : 'linked',
      repository: {
        external_repository_id: target,
        full_name: 'acme/payments',
        default_branch: 'main',
        visibility: 'public',
      },
      file_count: 3,
      pull_request: dryRun ? null : {url: PULL_REQUEST_URL, number: 128, state: 'open'},
    });
  }

  return {
    linkBodies,
    route: ({url, method, body}: {url: URL; method: string; body: unknown}) => {
      if (url.pathname === `/projects/${PROJECT_ID}/config/link` && method === 'POST') {
        return link(body as {external_repository_id: string; dry_run: boolean});
      }
      return fixed[url.pathname]?.();
    },
  };
}

function connectionDto() {
  return {
    id: CONNECTION_ID,
    workspace_id: PROJECT_TEST_WID,
    provider: 'github',
    external_account_id: '1001',
    slug: 'acme',
    display_name: 'acme',
    lifecycle_status: 'active',
    capabilities: ['source_control'],
    created_at: '2026-05-07T01:00:00.000Z',
    updated_at: '2026-05-07T01:00:00.000Z',
  };
}

function repositoryDto(name: string, externalRepositoryId: string, visibility = 'private') {
  return {
    connection_id: CONNECTION_ID,
    external_repository_id: externalRepositoryId,
    owner: 'acme',
    name,
    full_name: `acme/${name}`,
    default_branch: 'main',
    visibility,
    clone_url: `https://github.com/acme/${name}.git`,
    html_url: `https://github.com/acme/${name}`,
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
        workflow_model: {
          kind: 'workflow',
          name: 'Deploy production',
          triggers: [
            {id: 't1', key: 'on_demand', source: 'manual', event: 'fire'},
            {
              id: 't2',
              key: 'nightly',
              source: 'cron',
              event: 'tick',
              config: {schedule: '0 3 * * 1-5'},
            },
            {id: 't3', key: 'on_issue', source: 'sentry', event: 'issue.created'},
          ],
        },
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
