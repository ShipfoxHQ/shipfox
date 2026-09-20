'use client';

import type {ComponentProps, ReactNode} from 'react';
import {useLayoutEffect, useRef} from 'react';
import {Button} from '#components/button/index.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#components/select/index.js';
import {cn} from '#utils/cn.js';

export interface DataTableCompleteNavigation {
  count: number;
  kind: 'complete';
  onLoadMore?: never;
}

export interface DataTableAppendNavigation {
  hasMore: boolean;
  isError: boolean;
  isLoading: boolean;
  kind: 'append';
  loadedCount: number;
  onLoadMore: () => void;
  onRetry: () => void;
  pageCount?: never;
  totalCount?: number;
}

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

export type DataTablePagedNavigation = Omit<ComponentProps<'nav'>, 'aria-label'> &
  DataTablePageSizeProps & {
    'aria-label'?: string;
    kind: 'paged';
    nextPageLabel?: string;
    onPageChange: (pageIndex: number) => void;
    pageCount: number;
    pageIndex: number;
    pageLabel?: ReactNode;
    pageSizeLabel?: string;
    previousPageLabel?: string;
    totalCount?: number;
  };

export type DataTableNavigationProps =
  | DataTableCompleteNavigation
  | DataTableAppendNavigation
  | DataTablePagedNavigation;

function formatRows(count: number) {
  return `${count} ${count === 1 ? 'row' : 'rows'}`;
}

function formatResultCount(resultCount: number) {
  return `${resultCount} ${resultCount === 1 ? 'result' : 'results'}`;
}

function getAppendStatus(navigation: DataTableAppendNavigation) {
  const count =
    navigation.totalCount === undefined
      ? `${formatRows(navigation.loadedCount)} loaded`
      : `${navigation.loadedCount} loaded of ${navigation.totalCount}`;

  if (navigation.isError) return `Could not load more rows. ${count}`;
  if (!navigation.hasMore) return `${count}. No more rows to load.`;
  return count;
}

function DataTablePagedNavigation({
  'aria-label': ariaLabel = 'Table pagination',
  className,
  kind: _kind,
  nextPageLabel = 'Next',
  onPageChange,
  onPageSizeChange,
  pageCount,
  pageIndex,
  pageLabel,
  pageSize,
  pageSizeLabel = 'Rows per page',
  pageSizeOptions,
  previousPageLabel = 'Previous',
  totalCount,
  ...props
}: DataTablePagedNavigation) {
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
        {totalCount !== undefined ? (
          <span aria-atomic="true" aria-live="polite" role="status">
            {formatResultCount(totalCount)}
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
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={pageIndex === 0}
            onClick={() => onPageChange(0)}
          >
            First
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={pageIndex === 0}
            onClick={() => onPageChange(pageIndex - 1)}
          >
            {previousPageLabel}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={pageIndex >= pageCount - 1}
            onClick={() => onPageChange(pageIndex + 1)}
          >
            {nextPageLabel}
          </Button>
        </div>
      </div>
    </nav>
  );
}

export function DataTableNavigation(navigation: DataTableNavigationProps) {
  const actionRef = useRef<HTMLButtonElement>(null);
  const footerRef = useRef<HTMLElement>(null);
  const previousNavigationRef = useRef<DataTableNavigationProps>(navigation);
  const previousNavigation = previousNavigationRef.current;
  const actionHeldFocus =
    typeof document !== 'undefined' && actionRef.current === document.activeElement;
  const becameRetry =
    navigation.kind === 'append' &&
    navigation.isError &&
    previousNavigation.kind === 'append' &&
    !previousNavigation.isError;
  const becameExhausted =
    navigation.kind === 'append' &&
    !navigation.hasMore &&
    previousNavigation.kind === 'append' &&
    previousNavigation.hasMore;

  useLayoutEffect(() => {
    if (actionHeldFocus && becameRetry) actionRef.current?.focus();
    if (actionHeldFocus && becameExhausted) footerRef.current?.focus();

    previousNavigationRef.current = navigation;
  }, [actionHeldFocus, becameExhausted, becameRetry, navigation]);

  if (navigation.kind === 'complete') {
    return (
      <section
        ref={footerRef}
        aria-label="Table navigation"
        className="flex min-h-44 items-center border-t border-border-neutral-base bg-background-neutral-base px-row py-row outline-none focus:shadow-focus-inset"
        data-navigation-kind={navigation.kind}
        data-slot="data-table-footer"
        tabIndex={-1}
      >
        <span className="text-sm text-foreground-neutral-muted">
          {formatRows(navigation.count)}
        </span>
      </section>
    );
  }

  if (navigation.kind === 'paged') {
    return (
      <section
        ref={footerRef}
        aria-label="Table navigation"
        className="flex min-h-44 items-center border-t border-border-neutral-base bg-background-neutral-base px-row py-row outline-none focus:shadow-focus-inset"
        data-navigation-kind={navigation.kind}
        data-slot="data-table-footer"
        tabIndex={-1}
      >
        <DataTablePagedNavigation {...navigation} />
      </section>
    );
  }

  return (
    <section
      ref={footerRef}
      aria-label="Table navigation"
      className="flex min-h-44 items-center justify-between gap-group border-t border-border-neutral-base bg-background-neutral-base px-row py-row outline-none focus:shadow-focus-inset"
      data-navigation-kind={navigation.kind}
      data-slot="data-table-footer"
      tabIndex={-1}
    >
      <span
        aria-atomic="true"
        aria-live="polite"
        className="text-sm text-foreground-neutral-muted"
        role="status"
      >
        {getAppendStatus(navigation)}
      </span>
      {navigation.hasMore ? (
        <Button
          ref={actionRef}
          type="button"
          size="sm"
          variant="secondary"
          aria-busy={navigation.isLoading || undefined}
          aria-disabled={navigation.isLoading || undefined}
          aria-live={navigation.isLoading ? 'polite' : undefined}
          className={cn(
            navigation.isLoading &&
              'pointer-events-none cursor-default bg-background-neutral-disabled text-foreground-neutral-disabled shadow-none',
          )}
          {...(navigation.isLoading ? {iconLeft: 'spinner' as const} : {})}
          onClick={() => {
            if (navigation.isLoading) return;
            if (navigation.isError) navigation.onRetry();
            else navigation.onLoadMore();
          }}
        >
          {navigation.isError ? 'Retry' : 'Load more'}
        </Button>
      ) : null}
    </section>
  );
}
