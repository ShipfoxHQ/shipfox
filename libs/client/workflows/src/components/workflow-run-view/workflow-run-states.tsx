import {EmptyState, Skeleton} from '@shipfox/react-ui';

export function WorkflowRunSkeleton() {
  // Mirror the run header bar so the loading state lands in the same place as the loaded header.
  return (
    <section
      aria-label="Loading workflow run"
      className="flex w-full items-center gap-12 border-b border-border-neutral-base px-16 py-12"
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
