import type {WorkflowExpression} from '@shipfox/expression';
import type {AgentThinking} from '@shipfox/workflow-document';

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

export type WorkflowModelStep = WorkflowModelRunStep | WorkflowModelAgentStep;

interface WorkflowModelStepBase {
  readonly id: string;
  readonly sourceName?: string;
  readonly gate?: WorkflowModelStepGate;
}

export interface WorkflowModelRunStep extends WorkflowModelStepBase {
  readonly kind: 'run';
  readonly command: WorkflowModelRunCommand;
}

export interface WorkflowModelAgentStep extends WorkflowModelStepBase {
  readonly kind: 'agent';
  readonly model: string;
  readonly provider: string;
  readonly thinking: AgentThinking;
  readonly prompt: string;
}

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
