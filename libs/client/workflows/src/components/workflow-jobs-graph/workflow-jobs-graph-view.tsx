import {cn, Text} from '@shipfox/react-ui';
import {useId, useState} from 'react';
import type {WorkflowJobGraphModel} from './graph-model.js';
import {WorkflowJobsGraphContent} from './workflow-jobs-graph-content.js';

export function WorkflowJobsGraphView({
  model,
  className,
}: {
  model: WorkflowJobGraphModel;
  className?: string | undefined;
}) {
  const titleId = useId();
  const [selectedJobId, setSelectedJobId] = useState<string | undefined>();

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
        {model.warnings.length > 0 ? (
          <Text size="xs" className="shrink-0 text-foreground-neutral-muted">
            Large graph
          </Text>
        ) : null}
      </div>
      <WorkflowJobsGraphContent
        model={model}
        selectedJobId={selectedJobId}
        onSelectJob={setSelectedJobId}
      />
    </section>
  );
}
