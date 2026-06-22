import {useMemo} from 'react';
import {buildWorkflowJobGraphModel} from './graph-model.js';
import type {WorkflowJobsGraphProps} from './types.js';
import {WorkflowJobsGraphView} from './workflow-jobs-graph-view.js';

export function WorkflowJobsGraph({run, className}: WorkflowJobsGraphProps) {
  const model = useMemo(() => buildWorkflowJobGraphModel({run}), [run]);
  return <WorkflowJobsGraphView model={model} className={className} />;
}
