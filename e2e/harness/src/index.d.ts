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

/** A provider double the E2E deployment runs in the harness process. */
export interface ProviderMock {
  /** Where it listens, with the port it bound when the requested port was 0. */
  endpoint: URL;
  stop(): Promise<void>;
}

/** PostHog's REST API and MCP, at `/mcp`, on one port. */
export function startPosthogMock(endpoint: URL): Promise<ProviderMock>;
/** Jam's token introspection and MCP, at `/mcp`, on one port. */
export function startJamMock(endpoint: URL): Promise<ProviderMock>;
/** Claap's MCP, at the endpoint's path, and its `/__e2e` routes on the same port. */
export function startClaapMock(endpoint: URL): Promise<ProviderMock>;
