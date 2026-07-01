import type {WorkflowRunDetail} from '#core/workflow-run.js';

export interface JobsGraphProps {
  run: WorkflowRunDetail;
  selectedJobId?: string | undefined;
  defaultSelectedJobId?: string | undefined;
  onSelectedJobChange?: ((jobId: string | undefined) => void) | undefined;
  className?: string | undefined;
}
