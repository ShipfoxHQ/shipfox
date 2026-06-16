import type {WorkflowExpression} from '@shipfox/expression';

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
  readonly sourceLocation?: WorkflowSourceLocation;
  readonly kind: 'run';
  readonly command: WorkflowModelRunCommand;
  readonly gate?: WorkflowModelStepGate;
}

export interface WorkflowSourceLocation {
  readonly startLine: number;
  readonly endLine: number;
}

export type WorkflowStepSourceLocationMap = ReadonlyMap<
  string,
  ReadonlyMap<number, WorkflowSourceLocation>
>;

export interface WorkflowModelRunCommand {
  readonly kind: 'shell';
  readonly value: string;
}

export interface WorkflowModelStepGate {
  readonly successIf?: WorkflowExpression;
  readonly onFailure?: WorkflowModelStepFailureAction;
}

export interface WorkflowModelStepFailureAction {
  readonly restartFrom: string;
  readonly output?: string;
}

export interface WorkflowModelDependency {
  readonly from: string;
  readonly to: string;
}
