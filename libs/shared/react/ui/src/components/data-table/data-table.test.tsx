import {
  columnVisibilityFeature,
  createColumnHelper,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import {render, screen, within} from '@testing-library/react';
import type {ReactNode} from 'react';
import {DataTable} from './data-table.js';

interface Workflow {
  id: string;
  name: string;
  status: string;
}

const features = tableFeatures({});
const columnHelper = createColumnHelper<typeof features, Workflow>();
const columns = columnHelper.columns([
  columnHelper.accessor('name', {
    header: 'Workflow',
    cell: ({getValue}) => <strong>{getValue()}</strong>,
  }),
  columnHelper.accessor('status', {header: 'Status'}),
]);

const workflows: Workflow[] = [
  {id: 'deploy', name: 'Deploy production', status: 'Succeeded'},
  {id: 'nightly', name: 'Nightly verification', status: 'Running'},
];

interface CoreTableProps {
  children?: (table: ReturnType<typeof useCoreTable>) => ReactNode;
  data?: Workflow[];
}

function useCoreTable(data: Workflow[] = workflows) {
  return useTable({
    columns,
    data,
    features,
    getRowId: (workflow) => workflow.id,
  });
}

function CoreTable({children, data}: CoreTableProps) {
  const table = useCoreTable(data);
  return children?.(table) ?? <DataTable table={table} aria-label="Workflows" />;
}

const visibilityFeatures = tableFeatures({columnVisibilityFeature});
const visibilityColumnHelper = createColumnHelper<typeof visibilityFeatures, Workflow>();
const visibilityColumns = visibilityColumnHelper.columns([
  visibilityColumnHelper.accessor('name', {header: 'Workflow'}),
  visibilityColumnHelper.accessor('status', {header: 'Status'}),
  visibilityColumnHelper.display({id: 'actions', header: 'Actions', cell: () => 'Open'}),
]);

function EmptyVisibilityTable({loading = false}: {loading?: boolean}) {
  const table = useTable({
    columns: visibilityColumns,
    data: [],
    features: visibilityFeatures,
    getRowId: (workflow) => workflow.id,
    initialState: {columnVisibility: {status: false}},
  });

  return (
    <DataTable
      table={table}
      aria-label="Workflows"
      isLoading={loading}
      loadingLabel="Loading workflows"
      emptyContent="No workflows"
    />
  );
}

describe('DataTable', () => {
  test('renders semantic headers and cells through the configured table instance', () => {
    const {container} = render(<CoreTable />);

    const table = screen.getByRole('table', {name: 'Workflows'});
    const rows = within(table).getAllByRole('row');

    expect(within(table).getByRole('columnheader', {name: 'Workflow'})).toBeDefined();
    expect(
      within(table).getByRole('cell', {name: 'Deploy production'}).querySelector('strong'),
    ).not.toBeNull();
    expect(rows).toHaveLength(3);
    expect(container.querySelectorAll('[data-slot="panel"]')).toHaveLength(1);
    expect(container.querySelector('[data-row-id="deploy"]')).not.toBeNull();
  });

  test('spans empty and loading states across the current visible columns', () => {
    const {rerender} = render(<EmptyVisibilityTable />);

    expect(screen.getByText('No workflows').closest('td')?.getAttribute('colspan')).toBe('2');

    rerender(<EmptyVisibilityTable loading />);

    const loadingCell = screen.getByText('Loading workflows').closest('td');
    expect(loadingCell?.getAttribute('colspan')).toBe('2');
    expect(loadingCell?.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(2);
  });

  test('keeps stale rows visible and marks the table busy during a background refresh', () => {
    render(
      <CoreTable>
        {(table) => <DataTable table={table} aria-label="Workflows" isRefreshing />}
      </CoreTable>,
    );

    expect(screen.getByText('Deploy production')).toBeDefined();
    expect(screen.getByRole('table', {name: 'Workflows'}).getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByText('Loading results')).toBeNull();
  });

  test('maps selected state and non-navigation row metadata without row click behavior', () => {
    render(
      <CoreTable>
        {(table) => (
          <DataTable
            table={table}
            aria-label="Workflows"
            getRowProps={(row) => ({
              'aria-label': `${row.original.name} row`,
              'data-selected': row.id === 'nightly',
              title: row.original.status,
            })}
          />
        )}
      </CoreTable>,
    );

    const selectedRow = screen.getByRole('row', {name: 'Nightly verification row'});
    expect(selectedRow.getAttribute('data-selected')).toBe('true');
    expect(selectedRow.getAttribute('title')).toBe('Running');
    expect(selectedRow.getAttribute('tabindex')).toBeNull();
  });

  test('composes toolbar, footer, sticky headers, minimum width, and compact density', () => {
    const {container} = render(
      <CoreTable>
        {(table) => (
          <DataTable
            table={table}
            aria-label="Workflows"
            density="compact"
            minimumWidth={720}
            stickyHeader
            toolbar={<span>Table controls</span>}
            footer={<span>2 workflows</span>}
          />
        )}
      </CoreTable>,
    );

    const table = screen.getByRole('table', {name: 'Workflows'});
    const header = container.querySelector('[data-slot="table-header"]');
    const headCell = screen.getByRole('columnheader', {name: 'Workflow'});
    const bodyCell = screen.getByRole('cell', {name: 'Deploy production'});

    expect(table.style.minWidth).toBe('720px');
    expect(header?.classList.contains('sticky')).toBe(true);
    expect(headCell.classList.contains('h-32')).toBe(true);
    expect(bodyCell.classList.contains('py-6')).toBe(true);
    expect(container.querySelector('[data-slot="data-table-toolbar"]')?.textContent).toBe(
      'Table controls',
    );
    expect(container.querySelector('[data-slot="data-table-footer"]')?.textContent).toBe(
      '2 workflows',
    );
  });
});
