import {EmptyState} from '@shipfox/react-ui';

/**
 * Shown when a project has no workflow runs yet, in place of the empty rail and the
 * perpetual detail skeleton the loading-driven layout would otherwise leave behind.
 */
export function WorkflowRunFirstTimeUse() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-16">
      <EmptyState
        icon="pulseLine"
        title="No workflow runs yet"
        description="Runs will appear here once this project's workflows start running."
      />
    </div>
  );
}
