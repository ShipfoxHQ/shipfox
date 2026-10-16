import {useOptionalChrome, type WorkflowRunActionsProps} from './chrome-context.js';
import {ReportErrorBoundary} from './report-error-boundary.js';

/** Renders the `WorkflowRunActions` chrome slot, or nothing when the composing application omits it. */
export function WorkflowRunActionsSlot(props: WorkflowRunActionsProps) {
  const Slot = useOptionalChrome()?.WorkflowRunActions;
  if (!Slot) return null;
  return (
    <ReportErrorBoundary
      label="Failed to render workflow run actions."
      retryKey={props.workflowRunId}
    >
      <Slot {...props} />
    </ReportErrorBoundary>
  );
}
