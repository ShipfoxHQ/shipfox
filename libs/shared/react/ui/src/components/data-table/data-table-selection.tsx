'use client';

import type {RowSelectionState, SubscribeSource} from '@tanstack/react-table';
import {Subscribe} from '@tanstack/react-table';
import type {ComponentProps} from 'react';
import {Checkbox, type CheckedState} from '#components/checkbox/index.js';
import {cn} from '#utils/cn.js';

interface DataTableSelectableRow {
  getCanSelect: () => boolean;
  getIsSelected: () => boolean;
  id: string;
  table: {
    atoms: {rowSelection: SubscribeSource<RowSelectionState>};
  };
  toggleSelected: (value?: boolean) => void;
}

interface DataTableSelectionTable {
  atoms: {rowSelection: SubscribeSource<RowSelectionState>};
  getIsAllPageRowsSelected: () => boolean;
  getIsSomePageRowsSelected: () => boolean;
  getPaginatedRowModel: () => {flatRows: DataTableSelectableRow[]};
  toggleAllPageRowsSelected: (value?: boolean) => void;
}

type DataTableSelectionAccessibleName =
  | {'aria-label': string; 'aria-labelledby'?: string}
  | {'aria-label'?: string; 'aria-labelledby': string};

type SelectionCheckboxProps = Omit<
  ComponentProps<typeof Checkbox>,
  'aria-label' | 'aria-labelledby' | 'checked' | 'defaultChecked' | 'onCheckedChange'
> &
  DataTableSelectionAccessibleName;

export type DataTableSelectionHeaderProps = SelectionCheckboxProps & {
  table: DataTableSelectionTable;
};

export type DataTableSelectionCellProps = SelectionCheckboxProps & {
  row: DataTableSelectableRow;
};

export function DataTableSelectionHeader({
  disabled,
  table,
  ...props
}: DataTableSelectionHeaderProps) {
  return (
    <Subscribe source={table.atoms.rowSelection}>
      {() => {
        const hasSelectableRows = table
          .getPaginatedRowModel()
          .flatRows.some((row) => row.getCanSelect());
        const allSelected = table.getIsAllPageRowsSelected();
        const someSelected = table.getIsSomePageRowsSelected();
        let checked: CheckedState = false;
        if (allSelected) checked = true;
        else if (someSelected) checked = 'indeterminate';

        return (
          <Checkbox
            checked={checked}
            disabled={disabled || !hasSelectableRows}
            onCheckedChange={(checked) => table.toggleAllPageRowsSelected(checked === true)}
            {...props}
          />
        );
      }}
    </Subscribe>
  );
}

export function DataTableSelectionCell({disabled, row, ...props}: DataTableSelectionCellProps) {
  return (
    <Subscribe source={row.table.atoms.rowSelection} selector={(selection) => selection[row.id]}>
      {(selected) => (
        <Checkbox
          checked={selected ?? row.getIsSelected()}
          data-row-id={row.id}
          disabled={disabled || !row.getCanSelect()}
          onCheckedChange={(checked) => row.toggleSelected(checked === true)}
          {...props}
        />
      )}
    </Subscribe>
  );
}

export interface DataTableSelectionSummaryProps extends ComponentProps<'span'> {
  selectedCount: number;
  totalCount: number;
}

export function DataTableSelectionSummary({
  className,
  selectedCount,
  totalCount,
  ...props
}: DataTableSelectionSummaryProps) {
  return (
    <span
      aria-atomic="true"
      aria-live="polite"
      role="status"
      className={cn('text-sm text-foreground-neutral-muted', className)}
      {...props}
    >
      {selectedCount} of {totalCount} {totalCount === 1 ? 'row' : 'rows'} selected
    </span>
  );
}

export type DataTableSelectionResetTrigger = 'filter' | 'page' | 'sorting';
export type DataTableSelectionResetPolicy = Partial<
  Record<DataTableSelectionResetTrigger, boolean>
>;

export const defaultDataTableSelectionResetPolicy: Readonly<
  Record<DataTableSelectionResetTrigger, boolean>
> = {
  filter: true,
  page: true,
  sorting: true,
};

/**
 * Selection resets on page, filter, and sorting changes by default. A feature
 * may opt out only when it owns an explicit cross-page selection policy.
 */
export function shouldResetDataTableSelection(
  trigger: DataTableSelectionResetTrigger,
  policy: DataTableSelectionResetPolicy = {},
) {
  return policy[trigger] ?? defaultDataTableSelectionResetPolicy[trigger];
}
