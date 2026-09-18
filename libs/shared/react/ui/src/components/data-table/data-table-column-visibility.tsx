import type {ComponentProps} from 'react';
import {Button} from '#components/button/index.js';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '#components/dropdown-menu/index.js';
import {cn} from '#utils/cn.js';

export interface DataTableColumnMeta {
  label: string;
}

export interface DataTableVisibilityColumn {
  columnDef: {meta?: DataTableColumnMeta};
  getCanHide: () => boolean;
  getIsVisible: () => boolean;
  id: string;
  toggleVisibility: (visible?: boolean) => void;
}

export interface DataTableColumnVisibilityTable {
  getAllLeafColumns: () => DataTableVisibilityColumn[];
}

export interface DataTableColumnVisibilityProps extends Omit<ComponentProps<'div'>, 'children'> {
  label?: string;
  menuLabel?: string;
  table: DataTableColumnVisibilityTable;
}

export function DataTableColumnVisibility({
  className,
  label = 'Columns',
  menuLabel = 'Toggle columns',
  table,
  ...props
}: DataTableColumnVisibilityProps) {
  const hideableColumns = table.getAllLeafColumns().flatMap((column) => {
    const columnLabel = column.columnDef.meta?.label;
    return column.getCanHide() && columnLabel ? [{column, label: columnLabel}] : [];
  });

  if (hideableColumns.length === 0) return null;

  return (
    <div data-slot="data-table-column-visibility" className={cn('shrink-0', className)} {...props}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="secondary" size="sm" iconLeft="layoutColumnLine">
            {label}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{menuLabel}</DropdownMenuLabel>
          {hideableColumns.map(({column, label: columnLabel}) => (
            <DropdownMenuCheckboxItem
              key={column.id}
              checked={column.getIsVisible()}
              closeOnSelect={false}
              onCheckedChange={(checked) => column.toggleVisibility(checked === true)}
            >
              {columnLabel}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
