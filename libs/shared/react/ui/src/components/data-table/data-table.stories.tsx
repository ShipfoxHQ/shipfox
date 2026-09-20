import type {Meta, StoryObj} from '@storybook/react';
import {
  columnVisibilityFeature,
  createColumnHelper,
  createPaginatedRowModel,
  createSortedRowModel,
  metaHelper,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  type SortingState,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import {type ReactNode, useState} from 'react';
import {expect, screen, userEvent, within} from 'storybook/test';
import {StatusBadge} from '#components/badge/index.js';
import {Button} from '#components/button/index.js';
import {Combobox} from '#components/combobox/index.js';
import {DatePicker} from '#components/date-picker/index.js';
import {type DateRange, DateRangePicker} from '#components/date-range-picker/index.js';
import {EmptyState} from '#components/empty-state/index.js';
import {SearchInline} from '#components/search/index.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#components/select/index.js';
import {Code, Text} from '#components/typography/index.js';
import {DataTable} from './data-table.js';
import {
  type DataTableColumnMeta,
  DataTableColumnVisibility,
} from './data-table-column-visibility.js';
import type {DataTableNavigationProps} from './data-table-navigation.js';
import {DataTablePagination} from './data-table-pagination.js';
import {
  DataTableSelectionCell,
  DataTableSelectionHeader,
  DataTableSelectionSummary,
} from './data-table-selection.js';
import {DataTableSortableHeader} from './data-table-sortable-header.js';
import {DataTableToolbar} from './data-table-toolbar.js';

interface Workflow {
  id: string;
  name: string;
  path: string;
  status: 'Succeeded' | 'Running' | 'Failed';
  updatedAt: string;
}

const features = tableFeatures({
  columnMeta: metaHelper<DataTableColumnMeta>(),
  columnVisibilityFeature,
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
});
const columnHelper = createColumnHelper<typeof features, Workflow>();

function statusVariant(status: Workflow['status']) {
  if (status === 'Succeeded') return 'success';
  if (status === 'Running') return 'info';
  return 'error';
}

const columns = columnHelper.columns([
  columnHelper.accessor('name', {
    enableHiding: false,
    header: ({column}) => <DataTableSortableHeader column={column} label="Workflow" />,
    cell: ({getValue}) => <span className="font-medium">{getValue()}</span>,
    meta: {label: 'Workflow'},
  }),
  columnHelper.accessor('path', {
    header: 'Path',
    cell: ({getValue}) => <Code>{getValue()}</Code>,
    meta: {label: 'File path'},
  }),
  columnHelper.accessor('status', {
    header: 'Status',
    cell: ({getValue}) => {
      const status = getValue();
      return <StatusBadge variant={statusVariant(status)}>{status}</StatusBadge>;
    },
    meta: {label: 'Status'},
  }),
  columnHelper.accessor('updatedAt', {header: 'Updated', meta: {label: 'Last updated'}}),
  columnHelper.display({
    id: 'actions',
    enableHiding: false,
    enableSorting: false,
    header: 'Actions',
    cell: ({row}) => (
      <Button size="xs" variant="transparentMuted" aria-label={`Open ${row.original.name}`}>
        Open
      </Button>
    ),
    meta: {label: 'Actions'},
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
  clearFiltersAction?: ReactNode;
  compact?: boolean;
  data?: Workflow[];
  emptyContent?: ReactNode;
  filters?: ReactNode;
  initialSorting?: SortingState;
  loading?: boolean;
  minimumWidth?: number;
  navigation?: DataTableNavigationProps;
  refreshing?: boolean;
  sticky?: boolean;
}

function WorkflowTable({
  className,
  clearFiltersAction,
  compact = false,
  data = workflows,
  emptyContent,
  filters,
  initialSorting,
  loading = false,
  minimumWidth,
  navigation,
  refreshing = false,
  sticky = false,
}: WorkflowTableProps) {
  const table = useTable({
    columns,
    data,
    enableMultiSort: false,
    features,
    getRowId: (workflow) => workflow.id,
    initialState: initialSorting ? {sorting: initialSorting} : undefined,
    sortDescFirst: false,
  });
  const resolvedNavigation: DataTableNavigationProps | undefined =
    navigation ?? (loading ? undefined : {kind: 'complete', count: data.length});

  return (
    <DataTable
      table={table}
      aria-label="Project workflows"
      className={className}
      density={compact ? 'compact' : 'default'}
      emptyContent={emptyContent}
      isLoading={loading}
      isRefreshing={refreshing}
      loadingLabel="Loading workflows"
      minimumWidth={minimumWidth}
      {...(resolvedNavigation ? {navigation: resolvedNavigation} : {})}
      stickyHeader={sticky}
      toolbar={
        <DataTableToolbar
          resultCount={data.length}
          clearFiltersAction={clearFiltersAction}
          actions={
            <>
              <DataTableColumnVisibility table={table} />
              <Button size="sm" variant="secondary">
                New workflow
              </Button>
            </>
          }
        >
          {filters}
        </DataTableToolbar>
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

export const SortingStates: Story = {
  render: () => (
    <div className="grid w-[calc(100vw-32px)] max-w-1120 grid-cols-1 gap-24 lg:grid-cols-3">
      <div className="flex min-w-0 flex-col gap-tight">
        <Text size="xs" className="text-foreground-neutral-muted">
          Unsorted
        </Text>
        <WorkflowTable />
      </div>
      <div className="flex min-w-0 flex-col gap-tight">
        <Text size="xs" className="text-foreground-neutral-muted">
          Ascending
        </Text>
        <WorkflowTable initialSorting={[{id: 'name', desc: false}]} />
      </div>
      <div className="flex min-w-0 flex-col gap-tight">
        <Text size="xs" className="text-foreground-neutral-muted">
          Descending
        </Text>
        <WorkflowTable initialSorting={[{id: 'name', desc: true}]} />
      </div>
    </div>
  ),
};

const filterWorkflowOptions = workflows.map((workflow) => ({
  label: workflow.name,
  value: workflow.id,
}));

function ToolbarFilters({multiple = false}: {multiple?: boolean}) {
  const [query, setQuery] = useState('');
  const [workflow, setWorkflow] = useState('');
  const [date, setDate] = useState<Date>();
  const [range, setRange] = useState<DateRange>();

  if (!multiple) {
    return (
      <SearchInline
        aria-label="Search workflows"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onClear={() => setQuery('')}
        placeholder="Search workflows"
        size="small"
        className="min-w-200 flex-1"
      />
    );
  }

  return (
    <>
      <SearchInline
        aria-label="Search workflows"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onClear={() => setQuery('')}
        placeholder="Search workflows"
        size="small"
        className="min-w-200 flex-1"
      />
      <Select defaultValue="all">
        <SelectTrigger aria-label="Filter by status" size="small" className="w-144">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          <SelectItem value="running">Running</SelectItem>
          <SelectItem value="failed">Failed</SelectItem>
        </SelectContent>
      </Select>
      <div className="w-176">
        <Combobox
          id="data-table-workflow-filter"
          options={filterWorkflowOptions}
          value={workflow}
          onValueChange={setWorkflow}
          placeholder="Any workflow"
          searchPlaceholder="Search workflows"
        />
      </div>
      <DatePicker
        aria-label="Filter by date"
        date={date}
        onDateSelect={setDate}
        onClear={() => setDate(undefined)}
        size="small"
      />
      <DateRangePicker
        aria-label="Filter by date range"
        dateRange={range}
        onDateRangeSelect={setRange}
        onClear={() => setRange(undefined)}
        size="small"
      />
    </>
  );
}

export const ToolbarLayouts: Story = {
  render: () => (
    <div className="flex w-[calc(100vw-32px)] max-w-920 flex-col gap-24">
      <WorkflowTable />
      <WorkflowTable filters={<ToolbarFilters />} />
      <div className="max-w-720">
        <WorkflowTable
          filters={<ToolbarFilters multiple />}
          clearFiltersAction={
            <Button type="button" variant="transparentMuted" size="sm">
              Clear filters
            </Button>
          }
        />
      </div>
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

const appendNavigation: DataTableNavigationProps = {
  hasMore: true,
  isError: false,
  isLoading: false,
  kind: 'append',
  loadedCount: 50,
  onLoadMore: () => undefined,
  onRetry: () => undefined,
  totalCount: 143,
};

export const NavigationStates: Story = {
  render: () => (
    <div className="grid w-[calc(100vw-32px)] max-w-1120 grid-cols-1 gap-24 lg:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-tight">
        <Text size="xs" className="text-foreground-neutral-muted">
          Loading
        </Text>
        <WorkflowTable
          data={[]}
          loading
          navigation={{...appendNavigation, isLoading: true, loadedCount: 0, totalCount: undefined}}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-tight">
        <Text size="xs" className="text-foreground-neutral-muted">
          Appending
        </Text>
        <WorkflowTable navigation={{...appendNavigation, isLoading: true}} />
      </div>
      <div className="flex min-w-0 flex-col gap-tight">
        <Text size="xs" className="text-foreground-neutral-muted">
          Retry
        </Text>
        <WorkflowTable navigation={{...appendNavigation, isError: true}} />
      </div>
      <div className="flex min-w-0 flex-col gap-tight">
        <Text size="xs" className="text-foreground-neutral-muted">
          Exhausted
        </Text>
        <WorkflowTable navigation={{...appendNavigation, hasMore: false, loadedCount: 143}} />
      </div>
      <div className="flex min-w-0 flex-col gap-tight lg:col-span-2">
        <Text size="xs" className="text-foreground-neutral-muted">
          Complete
        </Text>
        <WorkflowTable navigation={{kind: 'complete', count: workflows.length}} />
      </div>
    </div>
  ),
};

function FilteredEmptyTable() {
  const [query, setQuery] = useState('production candidate');
  const filteredWorkflows = workflows.filter((workflow) =>
    workflow.name.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <WorkflowTable
      data={filteredWorkflows}
      filters={
        <SearchInline
          aria-label="Search workflows"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery('')}
          placeholder="Search workflows"
          size="small"
          className="min-w-200 flex-1"
        />
      }
      clearFiltersAction={
        query ? (
          <Button type="button" variant="transparentMuted" size="sm" onClick={() => setQuery('')}>
            Clear filters
          </Button>
        ) : null
      }
      emptyContent={
        <EmptyState
          icon="searchLine"
          title="No matching workflows"
          description="Clear the filters to show every workflow."
          variant="compact"
        />
      }
    />
  );
}

export const FilteredEmpty: Story = {
  render: () => (
    <div className="w-[calc(100vw-32px)] max-w-920">
      <FilteredEmptyTable />
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
    <div className="flex flex-col gap-cluster">
      <DataTable table={table} aria-label="Paginated workflows" />
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
    <div className="flex flex-col gap-cluster">
      <DataTable table={table} aria-label="Cursor-backed workflows" />
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
    </div>
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

function ManualSortingTable() {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pageIndex, setPageIndex] = useState(2);
  const table = useTable({
    columns,
    data: workflows,
    enableMultiSort: false,
    features,
    getRowId: (workflow) => workflow.id,
    manualSorting: true,
    onSortingChange: (updater) => {
      setSorting(updater);
      setPageIndex(0);
    },
    sortDescFirst: false,
    state: {sorting},
  });

  return (
    <DataTable
      table={table}
      aria-label="Server-sorted workflows"
      toolbar={
        <DataTableToolbar
          resultCount={workflows.length}
          actions={<DataTableColumnVisibility table={table} />}
        >
          <Text size="xs" className="text-foreground-neutral-muted">
            Page {pageIndex + 1}
          </Text>
        </DataTableToolbar>
      }
    />
  );
}

const UNSORTED_WORKFLOW_HEADER_REGEX = /Workflow, not sorted/;

export const ManualServerSorting: Story = {
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup();

    await user.click(canvas.getByRole('button', {name: UNSORTED_WORKFLOW_HEADER_REGEX}));

    await expect(canvas.getByText('Page 1')).toBeVisible();
  },
  render: () => (
    <div className="w-[calc(100vw-32px)] max-w-920">
      <ManualSortingTable />
    </div>
  ),
};

export const ColumnVisibility: Story = {
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup();

    await user.click(canvas.getByRole('button', {name: 'Columns'}));

    await screen.findByRole('menu');
  },
  render: () => (
    <div className="w-[calc(100vw-32px)] max-w-920">
      <WorkflowTable />
    </div>
  ),
};
