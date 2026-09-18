import {Button} from '#components/button/index.js';
import type {IconName} from '#components/icon/index.js';
import {cn} from '#utils/cn.js';

export interface DataTableSortableColumn {
  getCanSort: () => boolean;
  getIsSorted: () => false | 'asc' | 'desc';
  getNextSortingOrder: (multi?: boolean) => false | 'asc' | 'desc';
  toggleSorting: (descending?: boolean, multi?: boolean) => void;
}

export interface DataTableSortableHeaderProps {
  className?: string;
  column: DataTableSortableColumn;
  label: string;
}

function getSortStateLabel(direction: false | 'asc' | 'desc') {
  if (direction === 'asc') return 'sorted ascending';
  if (direction === 'desc') return 'sorted descending';
  return 'not sorted';
}

function getSortActionLabel(direction: false | 'asc' | 'desc') {
  if (direction === 'asc') return 'Sort ascending';
  if (direction === 'desc') return 'Sort descending';
  return 'Clear sorting';
}

function getSortIcon(direction: false | 'asc' | 'desc'): IconName {
  if (direction === 'asc') return 'arrowUpLine';
  if (direction === 'desc') return 'arrowDownLine';
  return 'expandUpDownLine';
}

export function DataTableSortableHeader({className, column, label}: DataTableSortableHeaderProps) {
  const direction = column.getIsSorted();
  const nextDirection = column.getNextSortingOrder(false);

  return (
    <Button
      type="button"
      variant="transparentMuted"
      size="sm"
      className={cn('-mx-inline px-tight text-xs font-medium', className)}
      disabled={!column.getCanSort()}
      aria-label={`${label}, ${getSortStateLabel(direction)}. ${getSortActionLabel(nextDirection)}.`}
      iconRight={getSortIcon(direction)}
      onClick={() => column.toggleSorting(undefined, false)}
    >
      {label}
    </Button>
  );
}
