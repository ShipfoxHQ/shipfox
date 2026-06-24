import {cn} from '@shipfox/react-ui';
import {useState} from 'react';
import type {WorkflowJobGraphModel} from './graph-model.js';
import {WorkflowJobsGraphContent} from './workflow-jobs-graph-content.js';

export function WorkflowJobsGraphView({
  model,
  selectedJobId,
  defaultSelectedJobId,
  onSelectedJobChange,
  className,
}: {
  model: WorkflowJobGraphModel;
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
      <WorkflowJobsGraphContent model={model} selectedJobId={selected} onSelectJob={selectJob} />
    </section>
  );
}
