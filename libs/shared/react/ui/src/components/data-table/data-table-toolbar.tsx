import type {ComponentProps, ReactNode} from 'react';
import {cn} from '#utils/cn.js';

export interface DataTableToolbarProps extends Omit<ComponentProps<'div'>, 'children'> {
  actions?: ReactNode;
  children?: ReactNode;
  clearFiltersAction?: ReactNode;
  formatResultCount?: (count: number) => string;
  resultCount?: number;
}

function defaultFormatResultCount(count: number) {
  return `${count} ${count === 1 ? 'result' : 'results'}`;
}

/**
 * Lays out feature-owned filters inside a DataTable toolbar without defining
 * their state or semantics.
 */
export function DataTableToolbar({
  actions,
  children,
  className,
  clearFiltersAction,
  formatResultCount = defaultFormatResultCount,
  resultCount,
  ...props
}: DataTableToolbarProps) {
  const hasLeadingContent = children || clearFiltersAction || resultCount !== undefined;

  return (
    <div
      data-slot="data-table-toolbar-layout"
      className={cn('flex min-w-0 flex-1 flex-wrap items-center gap-group', className)}
      {...props}
    >
      {hasLeadingContent ? (
        <div
          data-slot="data-table-toolbar-filters"
          className="flex min-w-0 flex-1 flex-wrap items-center gap-inline"
        >
          {children}
          {clearFiltersAction}
          {resultCount !== undefined ? (
            <span
              data-slot="data-table-result-count"
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className="text-xs text-foreground-neutral-muted"
            >
              {formatResultCount(resultCount)}
            </span>
          ) : null}
        </div>
      ) : null}
      {actions ? (
        <div
          data-slot="data-table-toolbar-actions"
          className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-inline"
        >
          {actions}
        </div>
      ) : null}
    </div>
  );
}
