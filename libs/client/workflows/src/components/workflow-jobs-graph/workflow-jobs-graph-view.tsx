import {cn, Text} from '@shipfox/react-ui';
import {useId, useState} from 'react';
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
  const titleId = useId();
  const [localSelectedJobId, setLocalSelectedJobId] = useState<string | undefined>(
    defaultSelectedJobId,
  );
  const selected = selectedJobId ?? localSelectedJobId;

  function selectJob(jobId: string | undefined) {
    setLocalSelectedJobId(jobId);
    onSelectedJobChange?.(jobId);
  }

  return (
    <section
      aria-labelledby={titleId}
      className={cn(
        'flex min-h-0 flex-col rounded-8 border border-border-neutral-base bg-background-components-base',
        className,
      )}
    >
      <div className="flex min-h-40 items-center justify-between gap-12 border-b border-border-neutral-base px-16">
        <div className="flex min-w-0 items-center gap-8">
          <Text as="h2" id={titleId} size="sm" bold className="text-foreground-neutral-base">
            Jobs graph
          </Text>
          <Text size="xs" className="text-foreground-neutral-muted">
            {model.nodes.length} {model.nodes.length === 1 ? 'job' : 'jobs'}
          </Text>
        </div>
      </div>
      <WorkflowJobsGraphContent model={model} selectedJobId={selected} onSelectJob={selectJob} />
    </section>
  );
}
