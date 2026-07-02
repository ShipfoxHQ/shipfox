import type {QueryLoadErrorQuery} from '@shipfox/client-ui';
import {Alert} from '@shipfox/react-ui/alert';
import {Button} from '@shipfox/react-ui/button';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {Text} from '@shipfox/react-ui/typography';

export function WorkflowRunSkeleton() {
  return (
    <section
      aria-label="Loading workflow run"
      className="border-b border-border-neutral-base bg-background-subtle-base px-16 py-12"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-12 gap-y-8">
        <div className="flex min-w-0 items-center gap-8">
          <Skeleton className="size-8 rounded-full" />
          <Skeleton className="h-24 w-180 rounded-6" />
        </div>
        <Skeleton className="h-24 w-88 rounded-6" />
        <span
          aria-hidden="true"
          className="hidden h-20 w-px shrink-0 bg-border-neutral-base sm:block"
        />
        <Skeleton className="h-20 w-64 rounded-4" />
        <Skeleton className="h-20 w-112 rounded-4" />
        <span className="min-w-0 flex-1" />
        <Skeleton className="h-20 w-88 rounded-4" />
        <Skeleton className="h-20 w-88 rounded-4" />
      </div>
    </section>
  );
}

export function WorkflowRunNotFound() {
  return (
    <EmptyState
      icon="pulseLine"
      title="Run not found"
      description="This run does not exist or is no longer available."
    />
  );
}

/**
 * Slim non-blocking banner shown when a background refetch fails after the run already
 * loaded (active-run polling can hit a transient API error), so the loaded run stays on
 * screen with an inline retry instead of being wiped by a full error placeholder.
 */
export function WorkflowRunStaleError({query}: {query: QueryLoadErrorQuery}) {
  return (
    <div className="border-b border-border-neutral-base p-8">
      <Alert variant="error" animated={false}>
        <div className="flex items-center justify-between gap-8">
          <Text size="xs">Could not refresh this run.</Text>
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
      </Alert>
    </div>
  );
}
