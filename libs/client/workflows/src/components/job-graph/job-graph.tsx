import {useMemo} from 'react';
import {buildJobGraphModel} from './graph-model.js';
import {JobGraphView} from './job-graph-view.js';
import type {JobGraphProps} from './types.js';

export function JobGraph({
  run,
  selectedJobId,
  defaultSelectedJobId,
  onSelectedJobChange,
  className,
}: JobGraphProps) {
  const model = useMemo(() => buildJobGraphModel({run}), [run]);
  return (
    <JobGraphView
      model={model}
      trigger={run}
      selectedJobId={selectedJobId}
      defaultSelectedJobId={defaultSelectedJobId}
      onSelectedJobChange={onSelectedJobChange}
      className={className}
    />
  );
}
