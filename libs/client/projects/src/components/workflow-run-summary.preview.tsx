import {RelativeTimeProvider} from '#lib/relative-time.js';
import {workflowRunSummaryFixtures} from './workflow-run-summary.fixtures.js';
import {WorkflowRunSummary} from './workflow-run-summary.js';

export function WorkflowRunSummaryPreview() {
  return (
    <RelativeTimeProvider>
      <div className="flex w-[1040px] flex-col gap-12 bg-background-neutral-background p-24">
        {workflowRunSummaryFixtures.map((run) => (
          <WorkflowRunSummary key={run.id} run={run} />
        ))}
      </div>
    </RelativeTimeProvider>
  );
}
