import {
  columnVisibilityFeature,
  createColumnHelper,
  createSortedRowModel,
  metaHelper,
  rowSortingFeature,
  type SortingState,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import {render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {useState} from 'react';
import {Button} from '#components/button/index.js';
import {DataTable} from './data-table.js';
import {
  type DataTableColumnMeta,
  DataTableColumnVisibility,
} from './data-table-column-visibility.js';
import {DataTableSortableHeader} from './data-table-sortable-header.js';
import {DataTableToolbar} from './data-table-toolbar.js';

interface Workflow {
  id: string;
  name: string;
  path: string;
  status: string;
}

const interactiveFeatures = tableFeatures({
  columnMeta: metaHelper<DataTableColumnMeta>(),
  columnVisibilityFeature,
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
});
const interactiveColumnHelper = createColumnHelper<typeof interactiveFeatures, Workflow>();
const interactiveColumns = interactiveColumnHelper.columns([
  interactiveColumnHelper.accessor('name', {
    enableHiding: false,
    header: ({column}) => <DataTableSortableHeader column={column} label="Workflow" />,
    meta: {label: 'Workflow'},
  }),
  interactiveColumnHelper.accessor('path', {
    header: 'Path',
    meta: {label: 'File path'},
  }),
  interactiveColumnHelper.accessor('status', {
    header: 'Status',
    meta: {label: 'Run status'},
  }),
  interactiveColumnHelper.display({
    id: 'actions',
    enableHiding: false,
    enableSorting: false,
    header: 'Actions',
    cell: () => 'Open',
    meta: {label: 'Actions'},
  }),
]);

const workflows: Workflow[] = [
  {
    id: 'deploy',
    name: 'Deploy production',
    path: '.shipfox/workflows/deploy.yml',
    status: 'Succeeded',
  },
  {
    id: 'nightly',
    name: 'Nightly verification',
    path: '.shipfox/workflows/nightly.yml',
    status: 'Running',
  },
];

const WORKFLOW_HEADER_REGEX = /Workflow/;
const UNSORTED_WORKFLOW_REGEX = /Workflow, not sorted/;
const ASCENDING_WORKFLOW_REGEX = /sorted ascending/;
const DESCENDING_WORKFLOW_REGEX = /sorted descending/;

function InteractiveTable({data = workflows}: {data?: Workflow[]}) {
  const table = useTable({
    columns: interactiveColumns,
    data,
    enableMultiSort: false,
    features: interactiveFeatures,
    getRowId: (workflow) => workflow.id,
    sortDescFirst: false,
  });

  return (
    <DataTable
      table={table}
      aria-label="Workflows"
      emptyContent="No workflows match these filters."
      navigation={{kind: 'complete', count: data.length}}
      toolbar={
        <DataTableToolbar
          resultCount={data.length}
          clearFiltersAction={
            <Button type="button" size="sm" variant="transparentMuted">
              Clear filters
            </Button>
          }
          actions={<DataTableColumnVisibility table={table} />}
        >
          <input aria-label="Search workflows" />
        </DataTableToolbar>
      }
    />
  );
}

function ManualSortingTable() {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pageIndex, setPageIndex] = useState(2);
  const table = useTable({
    columns: interactiveColumns,
    data: workflows,
    enableMultiSort: false,
    features: interactiveFeatures,
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
      aria-label="Server workflows"
      onSortChange={() => undefined}
      toolbar={
        <DataTableToolbar resultCount={workflows.length}>
          <span>Page {pageIndex + 1}</span>
        </DataTableToolbar>
      }
    />
  );
}

describe('DataTable controls', () => {
  test('sorts with pointer and keyboard input and exposes direction on the column header', async () => {
    const user = userEvent.setup();
    render(<InteractiveTable />);

    const header = screen.getByRole('columnheader', {name: WORKFLOW_HEADER_REGEX});
    const sortButton = within(header).getByRole('button', {name: UNSORTED_WORKFLOW_REGEX});
    expect(header.getAttribute('aria-sort')).toBe('none');

    await user.click(sortButton);

    expect(header.getAttribute('aria-sort')).toBe('ascending');
    expect(within(header).getByRole('button', {name: ASCENDING_WORKFLOW_REGEX})).toBeDefined();

    await user.click(within(header).getByRole('button', {name: ASCENDING_WORKFLOW_REGEX}));

    expect(header.getAttribute('aria-sort')).toBe('descending');
    expect(screen.getAllByRole('row')[1]?.textContent).toContain('Nightly verification');

    within(header).getByRole('button', {name: DESCENDING_WORKFLOW_REGEX}).focus();
    await user.keyboard('{Enter}');

    expect(header.getAttribute('aria-sort')).toBe('none');
    expect(screen.getAllByRole('row')[1]?.textContent).toContain('Deploy production');
  });

  test('lists labeled hideable columns and toggles visibility without closing the menu', async () => {
    const user = userEvent.setup();
    render(<InteractiveTable />);

    await user.click(screen.getByRole('button', {name: 'Columns'}));

    const menu = screen.getByRole('menu');
    const pathItem = within(menu).getByRole('menuitemcheckbox', {name: 'File path'});
    const statusItem = within(menu).getByRole('menuitemcheckbox', {name: 'Run status'});
    expect(within(menu).queryByRole('menuitemcheckbox', {name: 'Workflow'})).toBeNull();
    expect(within(menu).queryByRole('menuitemcheckbox', {name: 'Actions'})).toBeNull();

    await user.click(statusItem);

    expect(screen.getByRole('menu')).toBeDefined();
    expect(screen.queryByRole('columnheader', {name: 'Status'})).toBeNull();

    await user.click(pathItem);

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('columnheader', {name: 'Path'})).toBeNull();
    expect(screen.getByRole('columnheader', {name: WORKFLOW_HEADER_REGEX})).toBeDefined();
    expect(screen.getByRole('columnheader', {name: 'Actions'})).toBeDefined();
  });

  test('groups filters, reset, result feedback, and trailing actions in a wrapping toolbar', () => {
    const {container, rerender} = render(
      <DataTableToolbar
        resultCount={1}
        clearFiltersAction={<button type="button">Clear filters</button>}
        actions={<button type="button">Columns</button>}
      >
        <input aria-label="Search" />
      </DataTableToolbar>,
    );

    const filters = container.querySelector('[data-slot="data-table-toolbar-filters"]');
    const actions = container.querySelector('[data-slot="data-table-toolbar-actions"]');
    expect(filters?.classList.contains('flex-wrap')).toBe(true);
    expect(actions?.classList.contains('ml-auto')).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('1 result');

    rerender(<DataTableToolbar actions={<button type="button">Columns</button>} resultCount={0} />);

    expect(screen.getByRole('status').textContent).toBe('0 results');
    expect(container.querySelector('[data-slot="data-table-toolbar-actions"]')).not.toBeNull();
  });

  test('keeps the toolbar and clear action when filters return no rows', async () => {
    const user = userEvent.setup();
    render(<InteractiveTable data={[]} />);

    expect(screen.getByText('No workflows match these filters.')).toBeDefined();
    expect(screen.getByRole('button', {name: 'Clear filters'})).toBeDefined();
    expect(screen.getByRole('status').textContent).toBe('0 results');

    await user.click(screen.getByRole('button', {name: 'Clear filters'}));
  });

  test('lets a manual sorting callback reset pagination at the feature boundary', async () => {
    const user = userEvent.setup();
    render(<ManualSortingTable />);

    expect(screen.getByText('Page 3')).toBeDefined();

    await user.click(screen.getByRole('button', {name: UNSORTED_WORKFLOW_REGEX}));

    expect(screen.getByText('Page 1')).toBeDefined();
    expect(
      screen.getByRole('columnheader', {name: WORKFLOW_HEADER_REGEX}).getAttribute('aria-sort'),
    ).toBe('ascending');
  });
});
