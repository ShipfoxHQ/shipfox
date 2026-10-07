export type E2eEnvironment = Record<string, string | undefined>;

export type E2eReadyCheck =
  | string
  | URL
  | ((env: E2eEnvironment) => string | URL);

export interface E2eServer {
  name: string;
  command: string;
  args?: string[];
  env?: E2eEnvironment;
  ready?: E2eReadyCheck;
  before?: string;
  logFile?: string;
}

export interface RunE2eOptions {
  argv?: string[];
  env?: E2eEnvironment | ((source: E2eEnvironment) => E2eEnvironment);
  servers?: E2eServer[];
  diagnostics?: Array<(logDir: string) => void | Promise<void>>;
  beforeStart?: (context: {env: E2eEnvironment; logDir: string}) => void | Promise<void>;
}

export interface FakeRouter {
  name: string;
  stop(): Promise<void>;
}

export function runE2e(options?: RunE2eOptions): Promise<number>;
export function baseE2eEnv(source?: E2eEnvironment): E2eEnvironment;
export function startFakeRouters(env: E2eEnvironment): Promise<FakeRouter[]>;
export function collectE2eDiagnostics(logDir: string): Promise<void>;
export function copyPlaywrightTestResults(logDir: string): Promise<void>;
