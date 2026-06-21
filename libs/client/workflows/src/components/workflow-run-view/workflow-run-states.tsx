import type {QueryLoadErrorQuery} from '@shipfox/client-ui';
import {Alert, Button, EmptyState, Skeleton, Text} from '@shipfox/react-ui';

export function WorkflowRunSkeleton() {
  // Mirror the run header bar so the loading state lands in the same place as the loaded header.
  return (
    <section
      aria-label="Loading workflow run"
      className="flex w-full items-center gap-12 border-b border-border-neutral-base bg-background-subtle-base px-16 py-12"
    >
      <Skeleton className="h-24 w-160 rounded-6" />
      <Skeleton className="h-20 w-72 rounded-6" />
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
