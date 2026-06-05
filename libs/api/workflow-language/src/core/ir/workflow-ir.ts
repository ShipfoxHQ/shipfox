import type {AcceptancePolicyIR} from './expression-ir.js';

export type WorkflowId = string;
export type TriggerId = string;
export type JobId = string;
export type StepId = string;

export type RunnerSelectorIR = readonly string[];

export type WorkflowIR = Readonly<{
  id: WorkflowId;
  name: string;
  triggers: readonly TriggerIR[];
  runner: RunnerSelectorIR | null;
  jobs: readonly JobIR[];
  steps: readonly StepIR[];
  dependencies: readonly JobDependencyIR[];
}>;

export type TriggerIR = Readonly<{
  id: TriggerId;
  source: string;
  event: string;
  on: readonly string[] | null;
  with: Readonly<Record<string, unknown>> | null;
  filter: string | null;
}>;

export type JobIR = Readonly<{
  id: JobId;
  sourceName: string;
  dependencies: readonly JobId[];
  runner: RunnerSelectorIR | null;
  steps: readonly StepId[];
}>;

export type JobDependencyIR = Readonly<{
  from: JobId;
  to: JobId;
}>;

export type StepIR = RunStepIR;

export type RunStepIR = Readonly<{
  kind: 'run';
  id: StepId;
  jobId: JobId;
  name: string | null;
  command: RunCommandIR;
  acceptance: AcceptancePolicyIR;
}>;

export type RunCommandIR = Readonly<{
  kind: 'shell';
  value: string;
}>;
