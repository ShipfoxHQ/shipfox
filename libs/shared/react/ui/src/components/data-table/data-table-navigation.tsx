'use client';

import {useLayoutEffect, useRef} from 'react';
import {Button} from '#components/button/index.js';
import {cn} from '#utils/cn.js';

export interface DataTableCompleteNavigation {
  count: number;
  kind: 'complete';
}

export interface DataTableAppendNavigation {
  hasMore: boolean;
  isError: boolean;
  isLoading: boolean;
  kind: 'append';
  loadedCount: number;
  onLoadMore: () => void;
  onRetry: () => void;
  totalCount?: number;
}

export type DataTableNavigationProps = DataTableCompleteNavigation | DataTableAppendNavigation;

function formatRows(count: number) {
  return `${count} ${count === 1 ? 'row' : 'rows'}`;
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
