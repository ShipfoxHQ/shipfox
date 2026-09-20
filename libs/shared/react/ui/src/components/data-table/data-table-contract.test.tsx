import {
  columnFilteringFeature,
  columnVisibilityFeature,
  createColumnHelper,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import {render, screen} from '@testing-library/react';
import {DataTable} from './data-table.js';
import type {DataTableNavigationProps} from './data-table-navigation.js';

interface Workflow {
  id: string;
  name: string;
}

const workflows: Workflow[] = [{id: 'deploy', name: 'Deploy production'}];
const appendNavigation: DataTableNavigationProps = {
  hasMore: true,
  isError: false,
  isLoading: false,
  kind: 'append',
  loadedCount: workflows.length,
  onLoadMore: () => undefined,
  onRetry: () => undefined,
};

type HiddenCapability = 'filtering' | 'sorting';

function ContractTable({
  filtering = false,
  hiddenCapability,
  navigation,
  onFilterChange,
  onSortChange,
  sortable = true,
}: {
  filtering?: boolean;
  hiddenCapability?: HiddenCapability;
  navigation?: DataTableNavigationProps;
  onFilterChange?: () => void;
  onSortChange?: () => void;
  sortable?: boolean;
}) {
  const features = tableFeatures({
    columnFilteringFeature,
    columnVisibilityFeature,
    rowSortingFeature,
  });
  const columnHelper = createColumnHelper<typeof features, Workflow>();
  const table = useTable({
    columns: columnHelper.columns([
      columnHelper.accessor('name', {
        enableColumnFilter: filtering,
        enableSorting: sortable,
        header: 'Workflow',
      }),
    ]),
    data: workflows,
    features,
    getRowId: (workflow) => workflow.id,
    ...(hiddenCapability ? {initialState: {columnVisibility: {name: false}}} : {}),
  });

  return (
    <DataTable
      table={table}
      aria-label="Workflows"
      {...(navigation ? {navigation} : {})}
      {...(onFilterChange ? {onFilterChange} : {})}
      {...(onSortChange ? {onSortChange} : {})}
    />
  );
}

describe('DataTable navigation contract', () => {
  test('ignores hidden sortable columns in the navigation contract', () => {
    render(<ContractTable hiddenCapability="sorting" navigation={appendNavigation} />);

    expect(screen.queryByRole('columnheader', {name: 'Workflow'})).toBeNull();
    expect(screen.getByRole('table', {name: 'Workflows'})).toBeDefined();
  });

  test('ignores hidden filterable columns in the navigation contract', () => {
    render(
      <ContractTable
        filtering
        hiddenCapability="filtering"
        navigation={appendNavigation}
        sortable={false}
      />,
    );

    expect(screen.queryByRole('columnheader', {name: 'Workflow'})).toBeNull();
    expect(screen.getByRole('table', {name: 'Workflows'})).toBeDefined();
  });

  test('rejects sortable columns on an append table without server sorting', () => {
    expect(() => render(<ContractTable navigation={appendNavigation} />)).toThrow(
      'complete navigation or an onSortChange handler',
    );
  });

  test('allows sortable columns on a complete table', () => {
    render(<ContractTable navigation={{kind: 'complete', count: workflows.length}} />);

    expect(screen.getByRole('table', {name: 'Workflows'})).toBeDefined();
  });

  test('allows sortable columns on an append table with server sorting', () => {
    render(<ContractTable navigation={appendNavigation} onSortChange={() => undefined} />);

    expect(screen.getByRole('table', {name: 'Workflows'})).toBeDefined();
  });

  test('does not assert the contract in production', () => {
    vi.stubEnv('NODE_ENV', 'production');

    try {
      render(<ContractTable navigation={appendNavigation} />);
      expect(screen.getByRole('table', {name: 'Workflows'})).toBeDefined();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test('rejects filterable columns on an append table without server filtering', () => {
    expect(() =>
      render(
        <ContractTable
          filtering
          navigation={appendNavigation}
          onSortChange={() => undefined}
          sortable={false}
        />,
      ),
    ).toThrow('complete navigation or an onFilterChange handler');
  });

  test('allows filterable columns on a complete table', () => {
    render(
      <ContractTable
        filtering
        navigation={{kind: 'complete', count: workflows.length}}
        sortable={false}
      />,
    );

    expect(screen.getByRole('table', {name: 'Workflows'})).toBeDefined();
  });

  test('allows filterable columns on an append table with server filtering', () => {
    render(
      <ContractTable
        filtering
        navigation={appendNavigation}
        onFilterChange={() => undefined}
        sortable={false}
      />,
    );

    expect(screen.getByRole('table', {name: 'Workflows'})).toBeDefined();
  });
});
