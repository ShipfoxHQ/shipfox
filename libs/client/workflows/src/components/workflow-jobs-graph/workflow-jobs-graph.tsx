import {useMemo} from 'react';
import {buildJobGraphModel} from './graph-model.js';
import type {JobsGraphProps} from './types.js';
import {JobsGraphView} from './workflow-jobs-graph-view.js';

export function WorkflowJobsGraph({
  run,
  selectedJobId,
  defaultSelectedJobId,
  onSelectedJobChange,
  className,
}: JobsGraphProps) {
  const model = useMemo(() => buildJobGraphModel({run}), [run]);
  return (
    <JobsGraphView
      model={model}
      trigger={run}
      selectedJobId={selectedJobId}
      defaultSelectedJobId={defaultSelectedJobId}
      onSelectedJobChange={onSelectedJobChange}
      className={className}
    />
  );
}
