'use client';

import type {ComponentProps, ReactNode} from 'react';
import {Button} from '#components/button/index.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#components/select/index.js';
import {cn} from '#utils/cn.js';

type DataTablePageSizeProps =
  | {
      onPageSizeChange: (pageSize: number) => void;
      pageSize: number;
      pageSizeOptions: readonly number[];
    }
  | {
      onPageSizeChange?: never;
      pageSize?: never;
      pageSizeOptions?: never;
    };

export type DataTablePaginationProps = Omit<ComponentProps<'nav'>, 'aria-label'> &
  DataTablePageSizeProps & {
    'aria-label'?: string;
    canNextPage: boolean;
    canPreviousPage: boolean;
    nextPageLabel?: string;
    onFirstPage?: () => void;
    onNextPage: () => void;
    onPreviousPage: () => void;
    pageLabel?: ReactNode;
    pageSizeLabel?: string;
    previousPageLabel?: string;
    resultCount?: number;
  };

function formatResultCount(resultCount: number) {
  return `${resultCount} ${resultCount === 1 ? 'result' : 'results'}`;
}

/**
 * Renders data-source-neutral controls. Callers translate the callbacks into
 * TanStack pagination updates or cursor-backed navigation.
 */
export function DataTablePagination({
  'aria-label': ariaLabel = 'Table pagination',
  canNextPage,
  canPreviousPage,
  className,
  nextPageLabel = 'Next',
  onFirstPage,
  onNextPage,
  onPageSizeChange,
  onPreviousPage,
  pageLabel,
  pageSize,
  pageSizeLabel = 'Rows per page',
  pageSizeOptions,
  previousPageLabel = 'Previous',
  resultCount,
  ...props
}: DataTablePaginationProps) {
  const hasPageSizeControl =
    pageSize !== undefined && pageSizeOptions !== undefined && onPageSizeChange !== undefined;

  return (
    <nav
      aria-label={ariaLabel}
      className={cn(
        'flex w-full flex-wrap items-center justify-between gap-cluster text-sm',
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-group text-foreground-neutral-muted">
        {resultCount !== undefined ? (
          <span aria-atomic="true" aria-live="polite" role="status">
            {formatResultCount(resultCount)}
          </span>
        ) : null}
        {pageLabel ? <span className="text-foreground-neutral-subtle">{pageLabel}</span> : null}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-group">
        {hasPageSizeControl ? (
          <div className="flex items-center gap-8 text-foreground-neutral-muted">
            <span>{pageSizeLabel}</span>
            <Select
              value={String(pageSize)}
              onValueChange={(value) => onPageSizeChange(Number(value))}
            >
              <SelectTrigger
                aria-label={pageSizeLabel}
                className="w-72"
                size="small"
                variant="component"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {pageSizeOptions.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <div className="flex items-center gap-4">
          {onFirstPage ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={!canPreviousPage}
              onClick={onFirstPage}
            >
              First
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={!canPreviousPage}
            onClick={onPreviousPage}
          >
            {previousPageLabel}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={!canNextPage}
            onClick={onNextPage}
          >
            {nextPageLabel}
          </Button>
        </div>
      </div>
    </nav>
  );
}
