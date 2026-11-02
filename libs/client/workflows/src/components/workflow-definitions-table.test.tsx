import type {Definition} from '@shipfox/client-projects';
import {RelativeTimeProvider} from '@shipfox/react-ui/relative-time';
import {fireEvent, render, screen} from '@testing-library/react';
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
  onDismissRunError: vi.fn(),
  onRefreshDefinitions: vi.fn(),
  readiness: new Map(),
  runError: null,
  runningDefinitionId: null,
  sync: null,
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

describe('WorkflowDefinitionsTable needs setup tag', () => {
  test('shows a warning tag for an issue that blocks the start and keeps Run enabled', () => {
    render(
      table({
        readiness: new Map([
          [
            definition.id,
            [
              {kind: 'variable-missing', key: 'FLAG', locations: [], effect: 'blocks-start'},
              {kind: 'secret-missing', key: 'TOKEN', locations: [], effect: 'fails-job'},
            ],
          ],
        ]),
      }),
    );

    const tag = screen.getByRole('button', {name: 'Deploy production needs setup: 2 issues'});
    expect(tag).toHaveTextContent('Needs setup');
    expect(tag).toHaveClass('text-tag-warning-text');
    expect(screen.getByRole('button', {name: 'Run'})).toBeEnabled();
  });

  test('shows a neutral tag when every issue fails a job later', () => {
    render(
      table({
        readiness: new Map([
          [
            definition.id,
            [{kind: 'secret-missing', key: 'TOKEN', locations: [], effect: 'fails-job'}],
          ],
        ]),
      }),
    );

    const tag = screen.getByRole('button', {name: 'Deploy production needs setup: 1 issue'});
    expect(tag).toHaveClass('text-tag-neutral-text');
  });

  test('shows no tag without issues', () => {
    render(table({readiness: new Map([[definition.id, []]])}));

    expect(screen.queryByText('Needs setup')).not.toBeInTheDocument();
  });

  test('opens the definition from the tag', () => {
    const onOpenDefinition = vi.fn();
    render(
      table({
        onOpenDefinition,
        readiness: new Map([
          [
            definition.id,
            [{kind: 'variable-missing', key: 'FLAG', locations: [], effect: 'blocks-start'}],
          ],
        ]),
      }),
    );

    fireEvent.click(screen.getByText('Needs setup'));

    expect(onOpenDefinition).toHaveBeenCalledWith(definition);
  });
});
