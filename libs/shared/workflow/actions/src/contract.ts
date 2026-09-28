/**
 * The `v1` local contract between an action process and the runner that starts it. The runner
 * serves these routes on loopback and sets these variables; the SDK and the testing helper are
 * its clients. Changing a shape here is a breaking change for runners already in the field.
 */

export const ACTIONS_CONTRACT_VERSION = 'v1';

export const TOOLS_CALL_PATH = '/v1/tools/call';
export const TOOLS_DOWNLOAD_PATH = '/v1/tools/download';
export const TOOLS_LIST_PATH = '/v1/tools';

/** Encoded request body limit, sized so a 1 MB `create_commit` still fits after base64. */
export const MAX_TOOL_REQUEST_BYTES = 2 * 1024 * 1024;

/** One downloaded file. The gateway enforces the same limit. */
export const MAX_DOWNLOAD_FILE_BYTES = 100 * 1024 * 1024;
/** All downloads of one step together, counted as bytes arrive. */
export const MAX_STEP_DOWNLOAD_BYTES = 1024 * 1024 * 1024;

export const ACTION_ENV = {
  actionsUrl: 'SHIPFOX_ACTIONS_URL',
  actionsToken: 'SHIPFOX_ACTIONS_TOKEN',
  actionPath: 'SHIPFOX_ACTION_PATH',
  actionMain: 'SHIPFOX_ACTION_MAIN',
  actionInputs: 'SHIPFOX_ACTION_INPUTS',
  actionContext: 'SHIPFOX_ACTION_CONTEXT',
  actionResult: 'SHIPFOX_ACTION_RESULT',
  output: 'SHIPFOX_OUTPUT',
  workspace: 'SHIPFOX_WORKSPACE',
} as const;

/** Runner variables an action inherits. Everything else in the runner environment stays out. */
export const ACTION_INHERITED_ENV_KEYS: ReadonlySet<string> = new Set([
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'LANG',
  'TZ',
  'TMPDIR',
  'TERM',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'ALL_PROXY',
  'all_proxy',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
]);

/** The inherited part of an action environment: the allowlisted keys and every `LC_*`. */
export function inheritedActionEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const inherited: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (ACTION_INHERITED_ENV_KEYS.has(key) || key.startsWith('LC_')) inherited[key] = value;
  }
  return inherited;
}

export type ActionOutputType = 'string' | 'number' | 'boolean' | 'json';

export interface ActionOutputDeclaration {
  readonly type: ActionOutputType;
  readonly schema?: unknown;
  /** An absent value means required, as for step output declarations. */
  readonly required?: boolean;
}

export type ActionOutputDeclarations = Readonly<Record<string, ActionOutputDeclaration>>;

export interface ActionRunContext {
  readonly runId: string;
  readonly jobId: string;
  readonly jobKey: string;
  readonly stepId: string;
  readonly stepKey: string | null;
  /** The `uses` path, for example `./.shipfox/actions/slack-thread`. */
  readonly actionPath: string;
  readonly digest: string;
  readonly workspace: string;
}

/** The JSON file named by `SHIPFOX_ACTION_CONTEXT`. */
export interface ActionContextFileV1 {
  readonly context: ActionRunContext;
  readonly outputs: ActionOutputDeclarations;
}

/** The JSON file the bootstrap writes to `SHIPFOX_ACTION_RESULT`. */
export interface ActionResultFileV1 {
  readonly status: 'succeeded' | 'failed';
}

export interface ToolCallRequestV1 {
  readonly alias: string;
  /** A tool id, or `family.method`. */
  readonly tool: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

export interface ToolDownloadRequestV1 extends ToolCallRequestV1 {
  /** Resolved against the step working directory. A trailing `/` means a directory. */
  readonly destination: string;
}

export interface ToolContentBlockV1 {
  readonly type: string;
  readonly [key: string]: unknown;
}

export interface ToolErrorV1 {
  readonly code: string;
  readonly reason?: string;
  readonly message: string;
  readonly retry_after_seconds?: number;
  /** True when a request reached the provider but no answer came back. */
  readonly outcome_unknown: boolean;
}

export interface ToolFailureResponseV1 {
  readonly ok: false;
  readonly call_id: string | null;
  readonly error: ToolErrorV1;
}

export interface ToolCallSuccessResponseV1 {
  readonly ok: true;
  readonly call_id: string;
  readonly result: {
    readonly structured: unknown;
    readonly content: readonly ToolContentBlockV1[];
  };
}

export interface DownloadedFileV1 {
  /** Relative to the step working directory. */
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly media_type: string;
  readonly filename: string;
}

export interface ToolDownloadSuccessResponseV1 {
  readonly ok: true;
  readonly call_id: string;
  readonly file: DownloadedFileV1;
}

export type ToolCallResponseV1 = ToolCallSuccessResponseV1 | ToolFailureResponseV1;
export type ToolDownloadResponseV1 = ToolDownloadSuccessResponseV1 | ToolFailureResponseV1;

export interface GrantedToolV1 {
  readonly tool: string;
  readonly input_schema: unknown;
  readonly result: 'json' | 'file';
}

export interface ToolListResponseV1 {
  readonly aliases: Readonly<Record<string, {readonly tools: readonly GrantedToolV1[]}>>;
}
