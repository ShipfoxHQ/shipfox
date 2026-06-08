import type {WorkflowExpression} from '../expression/workflow-expression.js';

export interface WorkflowIR {
  kind: 'workflow';
  name: string;
  triggers: readonly WorkflowIRTrigger[];
  jobs: readonly WorkflowIRJob[];
  dependencies: readonly WorkflowIRDependency[];
}

export interface WorkflowIRTrigger {
  id: string;
  sourceName: string;
  source: string;
  event: string;
  inputs?: Readonly<Record<string, unknown>>;
  filter?: WorkflowIRExpression;
}

export interface WorkflowIRExpression {
  source: string;
  expression: WorkflowExpression;
}

export interface WorkflowIRJob {
  id: string;
  sourceName: string;
  runner: readonly string[];
  dependencies: readonly string[];
  steps: readonly WorkflowIRStep[];
}

export type WorkflowIRStep = WorkflowIRRunStep | WorkflowIRAgentStep;

export interface WorkflowIRStepBase {
  id: string;
  sourceName?: string;
  gate?: WorkflowIRGate;
}

export interface WorkflowIRRunStep extends WorkflowIRStepBase {
  kind: 'run';
  command: WorkflowIRRunCommand;
  acceptance: WorkflowIRStepAcceptance;
}

export interface WorkflowIRAgentStep extends WorkflowIRStepBase {
  kind: 'agent';
  agent: string;
  prompt: string;
  outputSchema?: Readonly<Record<string, string>>;
  session?: WorkflowIRAgentSession;
}

export interface WorkflowIRAgentSession {
  persistent?: boolean | undefined;
}

export interface WorkflowIRRunCommand {
  kind: 'shell';
  value: string;
}

export interface WorkflowIRGate {
  successIf?: WorkflowIRExpression;
  onFailure?: WorkflowIRGateOnFailure;
}

export interface WorkflowIRGateOnFailure {
  restartFrom: string;
  output?: string;
}

export interface WorkflowIRStepAcceptance {
  kind: 'default_run_exit_code';
}

export interface WorkflowIRDependency {
  from: string;
  to: string;
}

export type WorkflowModelDiagnosticCode =
  | 'WFM101'
  | 'WFM102'
  | 'WFM103'
  | 'WFM104'
  | 'WFM105'
  | 'WFM106'
  | 'WFM201'
  | 'WFM301'
  | 'WFM401'
  | 'WFM402'
  | 'WFM403'
  | 'WFM404';

export type WorkflowModelDiagnosticSeverity = 'error';
export type WorkflowModelDiagnosticPathSegment = string | number;

export interface WorkflowModelDiagnostic {
  code: WorkflowModelDiagnosticCode;
  severity: WorkflowModelDiagnosticSeverity;
  message: string;
  path: readonly WorkflowModelDiagnosticPathSegment[];
  details?: Readonly<Record<string, unknown>>;
}

export type NormalizeWorkflowDocumentResult =
  | {
      valid: true;
      ir: WorkflowIR;
      diagnostics: readonly [];
    }
  | {
      valid: false;
      diagnostics: readonly WorkflowModelDiagnostic[];
    };
