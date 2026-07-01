import {cn} from '@shipfox/react-ui';
import {useState} from 'react';
import type {WorkflowRunDetail} from '#core/workflow-run.js';
import type {WorkflowJobGraphModel} from './graph-model.js';
import {WorkflowJobsGraphContent} from './workflow-jobs-graph-content.js';

export function WorkflowJobsGraphView({
  model,
  trigger,
  selectedJobId,
  defaultSelectedJobId,
  onSelectedJobChange,
  className,
}: {
  model: WorkflowJobGraphModel;
  trigger: Pick<
    WorkflowRunDetail,
    'triggerDisplayLabel' | 'triggerLabel' | 'triggerProvider' | 'triggerSource'
  >;
  selectedJobId?: string | undefined;
  defaultSelectedJobId?: string | undefined;
  onSelectedJobChange?: ((jobId: string | undefined) => void) | undefined;
  className?: string | undefined;
}) {
  const [localSelectedJobId, setLocalSelectedJobId] = useState<string | undefined>(
    defaultSelectedJobId,
  );
  const selected = selectedJobId ?? localSelectedJobId;

  function selectJob(jobId: string | undefined) {
    setLocalSelectedJobId(jobId);
    onSelectedJobChange?.(jobId);
  }

  return (
    <section aria-label="Workflow jobs" className={cn('min-h-0', className)}>
      <WorkflowJobsGraphContent
        model={model}
        trigger={trigger}
        selectedJobId={selected}
        onSelectJob={selectJob}
      />
    </section>
  );
}
