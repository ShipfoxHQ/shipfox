import {ApiError} from '@shipfox/client-api';
import {QueryLoadError} from '@shipfox/client-ui';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {compositeAncestors, sourceFileLabel, sourceLinesLabel} from '#core/composite-step.js';
import type {StepSourceFile, StepSourceLocation} from '#core/workflow-run.js';
import {useWorkflowJobDetailQuery} from '#hooks/api/workflow-job-detail.js';
import {useWorkflowRunActionFileQuery} from '#hooks/api/workflow-run-overview.js';
import {
  WorkflowSourceBreadcrumb,
  type WorkflowSourceCaller,
  WorkflowSourceContent,
} from '../workflow-source-panel/index.js';

export interface WorkflowRunActionSourceProps {
  workflowRunId: string;
  file: StepSourceFile;
  highlightedLineRange: StepSourceLocation;
  /** The selected step, used to find the composite steps that call this file. */
  step: {jobId: string | null; jobExecutionId: string | null; stepId: string | null};
  onSelectCaller?: ((stepId: string) => void) | undefined;
}

/** Shows a composite action's manifest, with a path back to the steps that call it. */
export function WorkflowRunActionSource({
  workflowRunId,
  file,
  highlightedLineRange,
  step,
  onSelectCaller,
}: WorkflowRunActionSourceProps) {
  const fileQuery = useWorkflowRunActionFileQuery({workflowRunId, file});
  const callers = useCompositeCallers(step);

  if (fileQuery.isPending) {
    return (
      <div role="status" aria-label="Loading action source" className="p-panel">
        <Skeleton className="h-160 w-full rounded-8" />
      </div>
    );
  }
  if (fileQuery.isError) {
    if (fileQuery.error instanceof ApiError && fileQuery.error.status === 404) {
      return (
        <EmptyState
          variant="panel"
          className="min-h-160"
          icon="fileDamageLine"
          title="Action source unavailable"
          description="The action snapshot of this run does not include this file."
        />
      );
    }
    return (
      <div className="p-panel">
        <QueryLoadError query={fileQuery} subject="action source" icon="pulseLine" />
      </div>
    );
  }

  return (
    <WorkflowSourceContent
      source={{content: fileQuery.data.content, format: 'yaml'}}
      filename={sourceFileLabel(file)}
      highlightedLineRange={highlightedLineRange}
      scrollHighlightedIntoView
      breadcrumb={
        <WorkflowSourceBreadcrumb
          callers={callers}
          current={sourceFileLabel(file)}
          onSelectCaller={onSelectCaller}
        />
      }
    />
  );
}

function useCompositeCallers(step: WorkflowRunActionSourceProps['step']): WorkflowSourceCaller[] {
  const detailQuery = useWorkflowJobDetailQuery({
    jobId: step.jobId ?? undefined,
    executionId: step.jobExecutionId ?? undefined,
    enabled: step.stepId !== null,
  });
  const steps = detailQuery.data?.selectedExecution?.steps.items ?? [];
  if (!step.stepId) return [];
  return compositeAncestors(steps, step.stepId).flatMap((ancestor) =>
    ancestor.sourceLocation
      ? [
          {
            stepId: ancestor.id,
            label: `${sourceFileLabel(ancestor.sourceLocation.file)}:${sourceLinesLabel(ancestor.sourceLocation)}`,
          },
        ]
      : [],
  );
}
