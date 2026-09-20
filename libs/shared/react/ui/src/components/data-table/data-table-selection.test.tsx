import {
  createColumnHelper,
  createPaginatedRowModel,
  rowPaginationFeature,
  rowSelectionFeature,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {DataTable} from './data-table.js';
import {
  DataTableSelectionCell,
  DataTableSelectionHeader,
  DataTableSelectionSummary,
  shouldResetDataTableSelection,
} from './data-table-selection.js';

interface Workflow {
  disabled?: boolean;
  id: string;
  name: string;
}

const features = tableFeatures({
  paginatedRowModel: createPaginatedRowModel(),
  rowPaginationFeature,
  rowSelectionFeature,
});
const columnHelper = createColumnHelper<typeof features, Workflow>();
const columns = columnHelper.columns([
  columnHelper.display({
    id: 'selection',
    header: ({table}) => (
      <DataTableSelectionHeader table={table} aria-label="Select current page workflows" />
    ),
    cell: ({row}) => (
      <DataTableSelectionCell row={row} aria-label={`Select ${row.original.name}`} />
    ),
  }),
  columnHelper.accessor('name', {header: 'Workflow'}),
]);

const workflows: Workflow[] = [
  {id: 'deploy', name: 'Deploy production'},
  {id: 'locked', name: 'Locked workflow', disabled: true},
  {id: 'nightly', name: 'Nightly verification'},
];

function SelectionTable({data = workflows, pageSize = 10}: {data?: Workflow[]; pageSize?: number}) {
  const table = useTable({
    columns,
    data,
    enableRowSelection: (row) => !row.original.disabled,
    features,
    getRowId: (workflow) => workflow.id,
    initialState: {pagination: {pageIndex: 0, pageSize}},
  });

  return (
    <>
      <DataTable table={table} aria-label="Selectable workflows" />
      <DataTableSelectionSummary
        selectedCount={table.getSelectedRowIds().length}
        totalCount={data.length}
      />
    </>
  );
}

describe('DataTable selection controls', () => {
  test('selects only selectable current-page rows and marks selected table rows', async () => {
    const user = userEvent.setup();
    const {container} = render(<SelectionTable pageSize={2} />);

    await user.click(screen.getByRole('checkbox', {name: 'Select current page workflows'}));

    expect(
      screen.getByRole('checkbox', {name: 'Select Deploy production'}).getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      screen.getByRole('checkbox', {name: 'Select Locked workflow'}).hasAttribute('disabled'),
    ).toBe(true);
    expect(screen.queryByRole('checkbox', {name: 'Select Nightly verification'})).toBeNull();
    expect(
      screen
        .getByRole('checkbox', {name: 'Select current page workflows'})
        .getAttribute('aria-checked'),
    ).toBe('true');
    expect(container.querySelector('tr[data-row-id="deploy"]')?.getAttribute('data-selected')).toBe(
      'true',
    );
    expect(container.querySelector('tr[data-row-id="locked"]')?.hasAttribute('data-selected')).toBe(
      false,
    );
    expect(screen.getByRole('status').textContent).toBe('1 of 3 rows selected');
  });

  test('exposes an indeterminate header after one row is selected', async () => {
    const user = userEvent.setup();
    render(
      <SelectionTable
        data={[
          {id: 'deploy', name: 'Deploy production'},
          {id: 'nightly', name: 'Nightly verification'},
        ]}
      />,
    );

    await user.click(screen.getByRole('checkbox', {name: 'Select Deploy production'}));

    expect(
      screen
        .getByRole('checkbox', {name: 'Select current page workflows'})
        .getAttribute('aria-checked'),
    ).toBe('mixed');
    expect(screen.getByRole('status').textContent).toBe('1 of 2 rows selected');
  });

  test('disables current-page selection when no rows are selectable', () => {
    render(<SelectionTable data={[{id: 'locked', name: 'Locked workflow', disabled: true}]} />);

    expect(
      screen
        .getByRole('checkbox', {name: 'Select current page workflows'})
        .hasAttribute('disabled'),
    ).toBe(true);
  });
});

describe('DataTable selection reset policy', () => {
  test.each([
    'page',
    'filter',
    'sorting',
  ] as const)('resets selection after a %s change', (trigger) => {
    const shouldReset = shouldResetDataTableSelection(trigger);

    expect(shouldReset).toBe(true);
  });

  test('allows an explicit feature policy to preserve cross-page selection', () => {
    const shouldReset = shouldResetDataTableSelection('page', {page: false});

    expect(shouldReset).toBe(false);
  });
});
