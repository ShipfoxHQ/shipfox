import type {QueryLoadErrorQuery} from '@shipfox/client-ui';
import {Button} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {Text} from '@shipfox/react-ui/typography';

export function WorkflowRunListSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-8" role="status" aria-label="Loading runs">
      {Array.from({length: 6}).map((_, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: skeleton row, stable position
          key={index}
          className="flex flex-col gap-3 rounded-8 border border-transparent px-10 py-7"
        >
          <div className="flex h-20 items-center gap-7">
            <Skeleton className="size-6 shrink-0 rounded-full" />
            <Skeleton className="h-12 w-1/3" />
          </div>
          <div className="flex h-20 items-center gap-6 pl-13">
            <Skeleton className="h-12 flex-1" />
            <Skeleton className="h-12 w-40" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Slim non-blocking banner shown when a background refetch fails after a prior success,
 * so the already-loaded rows stay on screen with the retry inline rather than being
 * replaced by a full-placeholder error.
 */
export function WorkflowRunListStaleError({query}: {query: QueryLoadErrorQuery}) {
  return (
    <div className="border-b border-border-neutral-base p-8">
      <Callout role="alert" type="error">
        <div className="flex items-center justify-between gap-8">
          <Text size="xs">Could not refresh workflow runs.</Text>
          <Button
            type="button"
            size="2xs"
            variant="secondary"
            isLoading={query.isFetching}
            onClick={() => {
              void query.refetch();
            }}
          >
            Retry
          </Button>
        </div>
      </Callout>
    </div>
  );
}

export function WorkflowRunListEmpty() {
  return (
    <div className="p-16">
      <EmptyState
        icon="pulseLine"
        title="No runs yet"
        description="Runs from this project's workflows will appear here as soon as one is launched."
      />
    </div>
  );
}

export function WorkflowRunListNoMatches({onClear}: {onClear: () => void}) {
  return (
    <div className="p-16">
      <EmptyState
        icon="filterOffLine"
        title="No matching runs"
        description="No runs match your current search or status filter."
        action={
          <Button type="button" size="sm" variant="secondary" onClick={onClear}>
            Clear filters
          </Button>
        }
      />
    </div>
  );
}
