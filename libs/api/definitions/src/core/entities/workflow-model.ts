import type {ResolvedFieldSegment, WorkflowExpression} from '@shipfox/expression';
import type {AgentThinking} from '@shipfox/workflow-document';

export type WorkflowFieldTemplate = readonly ResolvedFieldSegment[];
export type WorkflowEnvTemplates = Readonly<Record<string, WorkflowFieldTemplate>>;

export interface WorkflowModel {
  readonly kind: 'workflow';
  readonly name: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly templates?: {
    readonly env?: WorkflowEnvTemplates;
  };
  readonly triggers: readonly WorkflowModelTrigger[];
  readonly jobs: readonly WorkflowModelJob[];
  readonly dependencies: readonly WorkflowModelDependency[];
}

export interface WorkflowModelTrigger {
  readonly id: string;
  readonly key: string;
  readonly source: string;
  readonly event: string;
  readonly inputs?: Readonly<Record<string, unknown>>;
  readonly filter?: string;
  readonly schedule?: string;
  readonly timezone?: string;
}

export interface WorkflowModelJob {
  readonly id: string;
  readonly key: string;
  readonly mode: WorkflowModelJobMode;
  readonly runner: readonly string[];
  readonly checkout: WorkflowModelJobCheckout;
  readonly success?: string;
  readonly executionTimeoutMs?: number;
  readonly listening?: WorkflowModelJobListening;
  readonly name?: WorkflowFieldTemplate;
  readonly env?: Readonly<Record<string, string>>;
  readonly templates?: {
    readonly env?: WorkflowEnvTemplates;
  };
  readonly dependencies: readonly string[];
  readonly steps: readonly WorkflowModelStep[];
}

export type WorkflowModelJobMode = 'one_shot' | 'listening';

export interface WorkflowModelJobListening {
  readonly on: readonly WorkflowModelListeningTrigger[];
  readonly until?: readonly WorkflowModelListeningTrigger[];
  readonly timeoutMs?: number;
  readonly maxExecutions?: number;
  readonly batch?: WorkflowModelListeningBatch;
  readonly onResolve: 'finish' | 'cancel';
}

export interface WorkflowModelListeningTrigger {
  readonly source: string;
  readonly event: string;
  readonly inputs?: Readonly<Record<string, unknown>>;
  readonly filter?: string;
}

export interface WorkflowModelListeningBatch {
  readonly debounceMs?: number;
  readonly maxSize?: number;
  readonly maxWaitMs?: number;
}

export interface WorkflowModelJobCheckout {
  readonly permissions: {readonly contents: 'read' | 'write'};
  readonly persistCredentials: boolean;
}

export type WorkflowModelStep = WorkflowModelRunStep | WorkflowModelAgentStep;

interface WorkflowModelStepBase {
  readonly id: string;
  readonly key?: string;
  readonly name?: string;
  readonly gate?: WorkflowModelStepGate;
  readonly sourceLocation?: WorkflowSourceLocation;
}

export interface WorkflowModelRunStep extends WorkflowModelStepBase {
  readonly kind: 'run';
  readonly command: WorkflowModelRunCommand;
  readonly env?: Readonly<Record<string, string>>;
  readonly templates?: {
    readonly command?: WorkflowFieldTemplate;
    readonly name?: WorkflowFieldTemplate;
    readonly env?: WorkflowEnvTemplates;
  };
}

export interface WorkflowModelAgentStep extends WorkflowModelStepBase {
  readonly kind: 'agent';
  readonly model?: string;
  readonly provider?: string;
  readonly thinking?: AgentThinking;
  readonly prompt: string;
  readonly templates?: {
    readonly prompt?: WorkflowFieldTemplate;
    readonly model?: WorkflowFieldTemplate;
    readonly provider?: WorkflowFieldTemplate;
    readonly name?: WorkflowFieldTemplate;
  };
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
