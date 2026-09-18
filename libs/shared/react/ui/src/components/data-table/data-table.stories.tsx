import type {Meta, StoryObj} from '@storybook/react';
import {
  createColumnHelper,
  createPaginatedRowModel,
  rowPaginationFeature,
  rowSelectionFeature,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import type {ReactNode} from 'react';
import {useState} from 'react';
import {StatusBadge} from '#components/badge/index.js';
import {Button} from '#components/button/index.js';
import {EmptyState} from '#components/empty-state/index.js';
import {Code, Text} from '#components/typography/index.js';
import {DataTable} from './data-table.js';
import {DataTablePagination} from './data-table-pagination.js';
import {
  DataTableSelectionCell,
  DataTableSelectionHeader,
  DataTableSelectionSummary,
} from './data-table-selection.js';

interface Workflow {
  id: string;
  name: string;
  path: string;
  status: 'Succeeded' | 'Running' | 'Failed';
  updatedAt: string;
}

const features = tableFeatures({});
const columnHelper = createColumnHelper<typeof features, Workflow>();

function statusVariant(status: Workflow['status']) {
  if (status === 'Succeeded') return 'success';
  if (status === 'Running') return 'info';
  return 'error';
}

const columns = columnHelper.columns([
  columnHelper.accessor('name', {
    header: 'Workflow',
    cell: ({getValue}) => <span className="font-medium">{getValue()}</span>,
  }),
  columnHelper.accessor('path', {
    header: 'Path',
    cell: ({getValue}) => <Code>{getValue()}</Code>,
  }),
  columnHelper.accessor('status', {
    header: 'Status',
    cell: ({getValue}) => {
      const status = getValue();
      return <StatusBadge variant={statusVariant(status)}>{status}</StatusBadge>;
    },
  }),
  columnHelper.accessor('updatedAt', {header: 'Updated'}),
  columnHelper.display({
    id: 'actions',
    header: 'Actions',
    cell: ({row}) => (
      <Button size="xs" variant="transparentMuted" aria-label={`Open ${row.original.name}`}>
        Open
      </Button>
    ),
  }),
]);

const workflows: Workflow[] = [
  {
    id: 'deploy-production',
    name: 'Deploy production',
    path: '.shipfox/workflows/deploy.yml',
    status: 'Succeeded',
    updatedAt: '2 minutes ago',
  },
  {
    id: 'nightly-verification',
    name: 'Nightly verification',
    path: '.shipfox/workflows/nightly.yml',
    status: 'Running',
    updatedAt: 'Now',
  },
  {
    id: 'release-candidate',
    name: 'Release candidate',
    path: '.shipfox/workflows/release-candidate-verification.yml',
    status: 'Failed',
    updatedAt: '18 minutes ago',
  },
];

interface WorkflowTableProps {
  className?: string;
  compact?: boolean;
  data?: Workflow[];
  emptyContent?: ReactNode;
  loading?: boolean;
  minimumWidth?: number;
  refreshing?: boolean;
  sticky?: boolean;
}

function WorkflowTable({
  className,
  compact = false,
  data = workflows,
  emptyContent,
  loading = false,
  minimumWidth,
  refreshing = false,
  sticky = false,
}: WorkflowTableProps) {
  const table = useTable({
    columns,
    data,
    features,
    getRowId: (workflow) => workflow.id,
  });

  return (
    <DataTable
      table={table}
      aria-label="Project workflows"
      className={className}
      density={compact ? 'compact' : 'default'}
      emptyContent={emptyContent}
      footer={
        <Text size="xs" className="text-foreground-neutral-muted">
          {loading ? 'Loading workflows' : `${data.length} workflows`}
        </Text>
      }
      isLoading={loading}
      isRefreshing={refreshing}
      loadingLabel="Loading workflows"
      minimumWidth={minimumWidth}
      stickyHeader={sticky}
      toolbar={
        <>
          <Text size="sm" className="font-medium">
            Workflows
          </Text>
          <Button size="sm" variant="secondary">
            New workflow
          </Button>
        </>
      }
    />
  );
}

const meta = {
  title: 'Components/DataTable',
  component: DataTable,
  tags: ['autodocs'],
  parameters: {layout: 'centered'},
} satisfies Meta<typeof DataTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: () => (
    <div className="w-[calc(100vw-32px)] max-w-920">
      <WorkflowTable />
    </div>
  ),
};

export const DataStates: Story = {
  render: () => (
    <div className="grid w-[calc(100vw-32px)] max-w-1120 grid-cols-1 gap-24 lg:grid-cols-2">
      <WorkflowTable data={[]} loading />
      <WorkflowTable refreshing />
      <WorkflowTable
        data={[]}
        emptyContent={
          <EmptyState
            icon="inboxLine"
            title="No workflows yet"
            description="Create a workflow to automate project work."
            variant="compact"
          />
        }
      />
      <WorkflowTable
        data={[]}
        emptyContent={
          <EmptyState
            tone="error"
            icon="errorWarningLine"
            title="Couldn't load workflows"
            description="Check your connection and try again."
            action={
              <Button size="sm" variant="secondary">
                Retry
              </Button>
            }
            variant="compact"
          />
        }
      />
    </div>
  ),
};

const scrollingStatuses: Workflow['status'][] = ['Succeeded', 'Running', 'Failed'];
const scrollingWorkflows: Workflow[] = Array.from({length: 12}, (_, index) => ({
  id: `workflow-${index}`,
  name: `Workflow ${String(index + 1).padStart(2, '0')}`,
  path: `.shipfox/workflows/workflow-${index + 1}.yml`,
  status: scrollingStatuses[index % scrollingStatuses.length] ?? 'Succeeded',
  updatedAt: `${index + 1} minutes ago`,
}));

export const Layouts: Story = {
  render: () => (
    <div className="flex w-[calc(100vw-32px)] max-w-920 flex-col gap-24">
      <div className="w-full max-w-520">
        <WorkflowTable minimumWidth={920} />
      </div>
      <WorkflowTable className="max-h-240" data={scrollingWorkflows} sticky />
      <WorkflowTable compact />
    </div>
  ),
};

const paginatedFeatures = tableFeatures({
  paginatedRowModel: createPaginatedRowModel(),
  rowPaginationFeature,
  rowSelectionFeature,
});
const paginatedColumnHelper = createColumnHelper<typeof paginatedFeatures, Workflow>();
const paginatedColumns = paginatedColumnHelper.columns([
  paginatedColumnHelper.display({
    id: 'selection',
    header: ({table}) => (
      <DataTableSelectionHeader table={table} aria-label="Select current page workflows" />
    ),
    cell: ({row}) => (
      <DataTableSelectionCell row={row} aria-label={`Select ${row.original.name}`} />
    ),
  }),
  paginatedColumnHelper.accessor('name', {
    header: 'Workflow',
    cell: ({getValue}) => <span className="font-medium">{getValue()}</span>,
  }),
  paginatedColumnHelper.accessor('status', {
    header: 'Status',
    cell: ({getValue}) => {
      const status = getValue();
      return <StatusBadge variant={statusVariant(status)}>{status}</StatusBadge>;
    },
  }),
  paginatedColumnHelper.accessor('updatedAt', {header: 'Updated'}),
]);

function BoundedPaginationExample() {
  const table = useTable({
    columns: paginatedColumns,
    data: scrollingWorkflows,
    enableRowSelection: (row) => row.original.status !== 'Failed',
    features: paginatedFeatures,
    getRowId: (workflow) => workflow.id,
    initialState: {pagination: {pageIndex: 0, pageSize: 3}},
  });
  const currentRows = table.getRowModel().rows;
  const currentPage = table.state.pagination.pageIndex + 1;
  const pageCount = table.getPageCount();

  function resetSelection() {
    table.resetRowSelection(true);
  }

  return (
    <DataTable
      table={table}
      aria-label="Paginated workflows"
      footer={
        <div className="flex w-full flex-col gap-8">
          <DataTableSelectionSummary
            selectedCount={table.getSelectedRowIds().length}
            totalCount={currentRows.filter((row) => row.getCanSelect()).length}
          />
          <DataTablePagination
            canNextPage={table.getCanNextPage()}
            canPreviousPage={table.getCanPreviousPage()}
            onFirstPage={() => {
              table.firstPage();
              resetSelection();
            }}
            onNextPage={() => {
              table.nextPage();
              resetSelection();
            }}
            onPageSizeChange={(pageSize) => {
              table.setPageSize(pageSize);
              resetSelection();
            }}
            onPreviousPage={() => {
              table.previousPage();
              resetSelection();
            }}
            pageLabel={`Page ${currentPage} of ${pageCount}`}
            pageSize={table.state.pagination.pageSize}
            pageSizeOptions={[3, 6, 12]}
            resultCount={scrollingWorkflows.length}
          />
        </div>
      }
    />
  );
}

const cursorPages = {
  start: {
    data: workflows.slice(0, 2),
    next: 'after-nightly',
    previous: null,
  },
  'after-nightly': {
    data: workflows.slice(2),
    next: null,
    previous: 'start',
  },
} as const;

type CursorPage = keyof typeof cursorPages;

function CursorPaginationExample() {
  const [cursor, setCursor] = useState<CursorPage>('start');
  const page = cursorPages[cursor];
  const table = useTable({
    columns,
    data: page.data,
    features,
    getRowId: (workflow) => workflow.id,
  });

  return (
    <DataTable
      table={table}
      aria-label="Cursor-backed workflows"
      footer={
        <DataTablePagination
          aria-label="Cursor-backed workflow pages"
          canNextPage={page.next !== null}
          canPreviousPage={page.previous !== null}
          onFirstPage={() => setCursor('start')}
          onNextPage={() => {
            if (page.next) setCursor(page.next);
          }}
          onPreviousPage={() => {
            if (page.previous) setCursor(page.previous);
          }}
          pageLabel="Current result page"
        />
      }
    />
  );
}

export const PaginationAndSelection: Story = {
  render: () => (
    <div className="grid w-[calc(100vw-32px)] max-w-1120 grid-cols-1 gap-24 lg:grid-cols-2">
      <BoundedPaginationExample />
      <CursorPaginationExample />
    </div>
  ),
};
