export type WorkflowDashboardStatus =
  | 'awaiting-runner'
  | 'cancelled'
  | 'failed'
  | 'pending'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'timed-out';

export type WorkflowDashboardLogStream = 'stdout' | 'stderr' | 'system';

export type WorkflowDashboardLogLine = {
  at: string;
  diagnostic?: boolean;
  gate?: boolean;
  message: string;
  stream: WorkflowDashboardLogStream;
};

export type WorkflowDashboardGateResult = {
  exitCode: number;
  passed: boolean;
  source: string;
};

export type WorkflowDashboardAttempt = {
  duration: number;
  exitCode: number | null;
  gateResult?: WorkflowDashboardGateResult;
  logs: WorkflowDashboardLogLine[];
  number: number;
  output?: Record<string, boolean | number | string>;
  startedAt: string;
  status: WorkflowDashboardStatus;
};

export type WorkflowDashboardGateInfo = {
  expr: string;
  reason: string;
  restartFrom: string;
};

export type WorkflowDashboardStep = {
  attemptCount: number;
  attempts: WorkflowDashboardAttempt[];
  command: string;
  duration: number | null;
  gate?: boolean;
  gateInfo?: WorkflowDashboardGateInfo;
  kind: 'agent' | 'command' | 'deploy' | 'integration' | 'notify';
  name: string;
  notRunLog?: WorkflowDashboardLogLine[];
  status: WorkflowDashboardStatus;
};

export type WorkflowDashboardJob = {
  duration: number | null;
  name: string;
  needs?: string;
  status: WorkflowDashboardStatus;
  steps: WorkflowDashboardStep[];
};

export type WorkflowDashboardRun = {
  duration: number;
  focus: {
    attempt: number;
    job: string;
    step: string;
  };
  jobs: WorkflowDashboardJob[];
  number: number | string;
  observedUntil: string;
  status: WorkflowDashboardStatus;
  trigger: {
    alertAt: string;
    event: string;
    filter: string;
    incident: string;
    payload: Record<string, unknown>;
    runStartedAt: string;
    source: string;
  };
};

export type WorkflowDashboardViewModel = {
  runOrder: string[];
  runs: Record<string, WorkflowDashboardRun>;
  workflow: {
    sourcePath: string;
    yaml: string;
  };
};
