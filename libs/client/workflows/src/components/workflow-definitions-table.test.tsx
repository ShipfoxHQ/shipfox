import type {Definition} from '@shipfox/client-projects';
import {RelativeTimeProvider} from '@shipfox/react-ui/relative-time';
import {render, screen} from '@testing-library/react';
import type {LatestRuns} from '#core/latest-run.js';
import {renderWithRouter} from '#test/render.js';
import {
  WorkflowDefinitionsTable,
  type WorkflowDefinitionsTableProps,
} from './workflow-definitions-table.js';

const REFRESH_ERROR = /Could not refresh workflows/u;
const SUCCEEDED_RUN_LINK_REGEX = /Succeeded/u;
const NEXT_PAGE_ERROR = /Could not load more rows\. 1 row loaded/u;

const definition: Definition = {
  id: '55555555-5555-4555-8555-555555555555',
  projectId: '44444444-4444-4444-8444-444444444444',
  configPath: '.shipfox/workflows/deploy.yml',
  source: 'vcs',
  sha: 'abc123',
  ref: 'main',
  name: 'Deploy production',
  workflowDocument: {},
  workflowModel: {},
  manualTrigger: {name: 'on_demand'},
  triggers: [{key: 'on_demand', source: 'manual', event: 'fire', schedule: null}],
  fetchedAt: '2026-05-07T01:00:00.000Z',
  createdAt: '2026-05-07T01:00:00.000Z',
  updatedAt: '2026-05-07T01:00:00.000Z',
};

const defaultProps: WorkflowDefinitionsTableProps = {
  definitions: [definition],
  hasNextPage: true,
  isError: false,
  isFetchNextPageError: false,
  isFetchingNextPage: false,
  isPending: false,
  isRefreshing: false,
  onLoadMore: vi.fn(),
  onOpenDefinition: vi.fn(),
  onRetry: vi.fn(),
  onRun: vi.fn(),
  onDismissRunError: vi.fn(),
  onRefreshDefinitions: vi.fn(),
  latestRuns: new Map(),
  runError: null,
  runningDefinitionId: null,
  searchQuery: '',
  onSearchChange: vi.fn(),
  sync: null,
  projectSlug: 'platform',
  workspaceSlug: 'acme',
};

function table(props: Partial<WorkflowDefinitionsTableProps> = {}) {
  return (
    <RelativeTimeProvider>
      <WorkflowDefinitionsTable {...defaultProps} {...props} />
    </RelativeTimeProvider>
  );
}

describe('WorkflowDefinitionsTable navigation states', () => {
  test('keeps loaded rows while distinguishing refresh and next-page failures', () => {
    const {rerender} = render(table());

    expect(screen.getByText('Deploy production')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Load more'})).toBeInTheDocument();

    rerender(table({isFetchNextPageError: true}));

    expect(screen.getByText('Deploy production')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(NEXT_PAGE_ERROR);
    expect(screen.getByRole('button', {name: 'Retry'})).toBeInTheDocument();
    expect(screen.queryByText(REFRESH_ERROR)).not.toBeInTheDocument();

    rerender(table({isError: true, isFetchNextPageError: false}));

    expect(screen.getByText('Deploy production')).toBeInTheDocument();
    expect(screen.getByText(REFRESH_ERROR)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('1 row loaded');
    expect(screen.queryByText(NEXT_PAGE_ERROR)).not.toBeInTheDocument();
  });
});

describe('WorkflowDefinitionsTable search', () => {
  test('keeps filtering the cached list after a refresh fails', () => {
    const archive = {...definition, id: 'archive', name: 'Archive artifacts'};

    render(
      table({
        definitions: [definition, archive],
        hasNextPage: false,
        isError: true,
        searchQuery: 'archive',
      }),
    );

    expect(screen.getByRole('textbox', {name: 'Search workflows'})).toBeEnabled();
    expect(screen.getByText('Archive artifacts')).toBeInTheDocument();
    expect(screen.queryByText('Deploy production')).not.toBeInTheDocument();
  });

  test('offers to clear a search once the list is empty', () => {
    render(table({definitions: [], hasNextPage: false, searchQuery: 'archive'}));

    expect(screen.getByRole('button', {name: 'Show all workflows'})).toBeInTheDocument();
  });
});

describe('WorkflowDefinitionsTable last run', () => {
  const latestRun = {
    id: '66666666-6666-4666-8666-666666666666',
    definitionId: definition.id,
    number: 7,
    status: 'succeeded',
    createdAt: new Date().toISOString(),
  } as const;

  test('links the latest run with its status', async () => {
    const latestRuns: LatestRuns = new Map([[definition.id, {status: 'found', run: latestRun}]]);

    renderWithRouter(table({latestRuns}));

    const link = await screen.findByRole('link', {name: SUCCEEDED_RUN_LINK_REGEX});
    expect(link).toHaveAttribute('href', `/w/acme/p/platform/runs/${latestRun.id}`);
  });

  test.each([
    ['none', 'No runs yet'],
    ['error', 'Unavailable'],
  ] as const)('says %s in words', (status, text) => {
    render(table({latestRuns: new Map([[definition.id, {status}]])}));

    expect(screen.getByText(text)).toBeInTheDocument();
  });

  test('holds the row back until its page answers', () => {
    render(table({latestRuns: new Map()}));

    expect(screen.queryByText('No runs yet')).not.toBeInTheDocument();
    expect(screen.queryByText('Unavailable')).not.toBeInTheDocument();
  });
});
