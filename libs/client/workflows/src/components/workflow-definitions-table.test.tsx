import type {Definition} from '@shipfox/client-projects';
import {RelativeTimeProvider} from '@shipfox/react-ui/relative-time';
import {render, screen} from '@testing-library/react';
import {
  WorkflowDefinitionsTable,
  type WorkflowDefinitionsTableProps,
} from './workflow-definitions-table.js';

const REFRESH_ERROR = /Could not refresh workflows/u;
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
  runError: null,
  runningDefinitionId: null,
  sync: null,
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
