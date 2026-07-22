import {TemporalFailure} from '@temporalio/common';
import {
  type Next,
  proxySinks,
  type Sinks,
  type WorkflowExecuteInput,
  type WorkflowInboundCallsInterceptor,
  type WorkflowInterceptors,
  workflowInfo,
} from '@temporalio/workflow';

interface ErrorMonitoringSinks extends Sinks {
  shipfoxErrorMonitoring: {
    reportWorkflowError(error: WorkflowErrorReport): void;
  };
}

export interface WorkflowErrorReport {
  name: string;
  message: string;
  stack?: string;
  workflowType: string;
  taskQueue: string;
  workflowId: string;
  runId: string;
  attempt: number;
}

const {shipfoxErrorMonitoring} = proxySinks<ErrorMonitoringSinks>();

class WorkflowErrorInterceptor implements WorkflowInboundCallsInterceptor {
  async execute(
    input: WorkflowExecuteInput,
    next: Next<WorkflowInboundCallsInterceptor, 'execute'>,
  ): Promise<unknown> {
    try {
      return await next(input);
    } catch (error) {
      if (!(error instanceof TemporalFailure)) {
        const info = workflowInfo();
        const report: WorkflowErrorReport = {
          name: error instanceof Error ? error.name : 'NonErrorThrown',
          message: error instanceof Error ? error.message : 'Non-Error value thrown',
          workflowType: info.workflowType,
          taskQueue: info.taskQueue,
          workflowId: info.workflowId,
          runId: info.runId,
          attempt: info.attempt,
        };
        if (error instanceof Error && error.stack) report.stack = error.stack;
        shipfoxErrorMonitoring.reportWorkflowError(report);
      }
      throw error;
    }
  }
}

export function interceptors(): WorkflowInterceptors {
  return {inbound: [new WorkflowErrorInterceptor()]};
}
