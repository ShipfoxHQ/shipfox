import {useLocation} from '@tanstack/react-router';
import {type ComponentType, useMemo} from 'react';
import {useOptionalChrome, type WorkflowRunActionsProps} from './chrome-context.js';
import {ReportErrorBoundary} from './report-error-boundary.js';

/** Renders the `WorkflowRunActions` chrome slot, or nothing when the composing application omits it. */
export function WorkflowRunActionsSlot(props: WorkflowRunActionsProps) {
  const Slot = useOptionalChrome()?.WorkflowRunActions;
  if (!Slot) return null;
  return <GuardedWorkflowRunActions slot={Slot} {...props} />;
}

function GuardedWorkflowRunActions({
  slot: Slot,
  ...props
}: WorkflowRunActionsProps & {slot: ComponentType<WorkflowRunActionsProps>}) {
  const location = useLocation();
  // Matches the header slot: a failed slot retries on the next navigation, such as an attempt or tab switch.
  const retryKey = useMemo(() => ({href: location.href, slot: Slot}), [location.href, Slot]);
  return (
    <ReportErrorBoundary label="Failed to render workflow run actions." retryKey={retryKey}>
      <Slot {...props} />
    </ReportErrorBoundary>
  );
}
