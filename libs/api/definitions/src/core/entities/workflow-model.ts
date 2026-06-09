export interface WorkflowModel {
  readonly kind: 'workflow';
  readonly name: string;
  readonly triggers: readonly WorkflowModelTrigger[];
  readonly jobs: readonly WorkflowModelJob[];
  readonly dependencies: readonly WorkflowModelDependency[];
}

export interface WorkflowModelTrigger {
  readonly id: string;
  readonly sourceName: string;
  readonly source: string;
  readonly event: string;
  readonly inputs?: Readonly<Record<string, unknown>>;
  // Trigger filters stay as source strings until event-schema-backed CEL validation exists.
  readonly filter?: string;
}

export interface WorkflowModelJob {
  readonly id: string;
  readonly sourceName: string;
  readonly runner: readonly string[];
  readonly dependencies: readonly string[];
  readonly steps: readonly WorkflowModelStep[];
}

export interface WorkflowModelStep {
  readonly id: string;
  readonly sourceName?: string;
  readonly kind: 'run';
  readonly command: WorkflowModelRunCommand;
}

export interface WorkflowModelRunCommand {
  readonly kind: 'shell';
  readonly value: string;
}

export interface WorkflowModelDependency {
  readonly from: string;
  readonly to: string;
}
