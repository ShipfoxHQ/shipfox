import {readFileSync} from 'node:fs';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {
  ACTION_ENV,
  type ActionContextFileV1,
  type ActionOutputDeclarations,
  type ActionResultFileV1,
} from '@shipfox/actions/contract';
import {ACTION_BOOTSTRAP_PATH, ACTION_LOADER_PATH} from '@shipfox/actions/runtime-files';
import type {StepDto} from '@shipfox/api-workflows-dto';
import {actionBundleDigestSchema} from '@shipfox/workflow-document';
import {z} from 'zod';
import {prepareActionBundle} from '#core/action-bundle.js';
import {
  type ActionIntegrationGrant,
  type ActionToolRow,
  type ActionToolsUpstream,
  startActionEndpoint,
} from '#core/action-endpoint.js';
import {executeStepProcess, type StepProcessOptions} from '#core/run-step.js';
import type {StepResult} from '#core/step-result.js';

const PRIVATE_FILE_MODE = 0o600;

/** Runner variables an action inherits. Everything else in the runner environment stays out. */
const INHERITED_ENV_KEYS = new Set([
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

const sensitivitySchema = z.enum(['read', 'write']);

const actionIntegrationsSchema = z
  .array(
    z.object({
      alias: z.string().min(1),
      connection_slug: z.string().min(1),
      tools: z.array(
        z.object({
          id: z.string().min(1),
          sensitivity: sensitivitySchema,
          // A config written before `sensitive` existed redacts rather than leaks.
          sensitive: z.boolean().default(true),
          result: z.enum(['json', 'file']).default('json'),
          input_schema: z.unknown(),
          methods: z
            .array(
              z.object({
                id: z.string().min(1),
                sensitivity: sensitivitySchema,
                sensitive: z.boolean().default(true),
              }),
            )
            .optional(),
        }),
      ),
    }),
  )
  .default([]);

const actionStepConfigSchema = z.object({
  action: z.object({
    uses: z.string().min(1),
    digest: actionBundleDigestSchema,
    main: z.string().min(1),
    name: z.string(),
  }),
  job_key: z.string().default(''),
  inputs: z.record(z.string(), z.unknown()).default({}),
  env: z.record(z.string(), z.string()).default({}),
  integrations: actionIntegrationsSchema,
  outputs: z
    .record(
      z.string(),
      z.object({
        type: z.enum(['string', 'number', 'boolean', 'json']),
        schema: z.unknown().optional(),
        required: z.boolean().optional(),
      }),
    )
    .default({}),
});

type ActionStepConfig = z.infer<typeof actionStepConfigSchema>;

export interface ActionStepOptions
  extends Pick<
    StepProcessOptions,
    | 'signal'
    | 'gitConfigGlobal'
    | 'secretValues'
    | 'subscribeSecrets'
    | 'memoryEventsPath'
    | 'onOutput'
  > {
  /** The step working directory, used as the action process `cwd`. */
  cwd: string;
  workspace: string;
  /** Runner-owned job directory outside the workspace, for extracted bundles and step files. */
  jobTempDir: string;
  runId: string;
  jobId: string;
  /** Loads the gzipped bundle. Called only when the job has not extracted this digest yet. */
  loadBundle: () => Promise<Uint8Array>;
  secretEnv?: Readonly<Record<string, string>>;
  /** Secret input values. They reach the inputs file only, never the environment. */
  secretInputs?: Readonly<Record<string, string>>;
  /** Receives the lines the runner writes to the step log. */
  onLogLine?: (line: string) => void;
  /** Receives the per-step endpoint token, so the step log can mask it. */
  onSecret?: (secret: string) => void;
  /** The integration tools gateway. Without it, the action's tool calls fail. */
  toolsUpstream?: ActionToolsUpstream;
  /** Receives the tool call and result rows for the step log. */
  onToolRow?: (row: ActionToolRow) => void;
}

/**
 * Runs an action step in its own Node process: `node --import <loader> <bootstrap>`. Success
 * needs exit code 0 and a `succeeded` result file. The process group is killed after every exit,
 * and outputs and annotations are kept even when the action fails.
 */
export async function executeActionStep(
  step: StepDto,
  options: ActionStepOptions,
): Promise<StepResult> {
  const parsed = actionStepConfigSchema.safeParse(step.config);
  if (!parsed.success) return failure({message: 'The action step config is invalid.'});
  const config = parsed.data;
  options.onLogLine?.(runtimeLine(config.action));

  let actionPath: string;
  try {
    actionPath = await prepareActionBundle({
      jobTempDir: options.jobTempDir,
      digest: config.action.digest,
      load: options.loadBundle,
    });
  } catch (error) {
    return failure({
      message: `The action could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
      reason: 'action_unavailable',
    });
  }

  await mkdir(join(options.jobTempDir, 'steps'), {recursive: true});
  const stepTemp = await mkdtemp(join(options.jobTempDir, 'steps', 'step-'));
  const endpoint = await startActionEndpoint({
    integrations: integrationGrants(config.integrations),
    cwd: options.cwd,
    workspace: options.workspace,
    upstream: options.toolsUpstream,
    signal: options.signal,
    onToolRow: options.onToolRow,
  });
  options.onSecret?.(endpoint.token);
  try {
    const paths = {
      inputs: join(stepTemp, 'inputs.json'),
      context: join(stepTemp, 'context.json'),
      result: join(stepTemp, 'result.json'),
    };
    await writeFile(paths.inputs, JSON.stringify({...config.inputs, ...options.secretInputs}), {
      mode: PRIVATE_FILE_MODE,
    });
    await writeFile(paths.context, JSON.stringify(contextFile(step, config, options)), {
      mode: PRIVATE_FILE_MODE,
    });

    const result = await executeStepProcess(
      {
        argv: [
          process.execPath,
          '--import',
          ACTION_LOADER_PATH,
          '--disable-warning=ExperimentalWarning',
          ACTION_BOOTSTRAP_PATH,
        ],
      },
      {
        cwd: options.cwd,
        workspace: options.workspace,
        env: {
          ...inheritedEnv(),
          ...config.env,
          ...options.secretEnv,
          [ACTION_ENV.actionPath]: actionPath,
          [ACTION_ENV.actionMain]: config.action.main,
          [ACTION_ENV.actionInputs]: paths.inputs,
          [ACTION_ENV.actionContext]: paths.context,
          [ACTION_ENV.actionResult]: paths.result,
          [ACTION_ENV.actionsUrl]: endpoint.url,
          [ACTION_ENV.actionsToken]: endpoint.token,
        },
        secretValues: [...(options.secretValues ?? []), endpoint.token],
        killGroupAfterExit: true,
        ...(options.signal ? {signal: options.signal} : {}),
        ...(options.gitConfigGlobal ? {gitConfigGlobal: options.gitConfigGlobal} : {}),
        ...(options.subscribeSecrets ? {subscribeSecrets: options.subscribeSecrets} : {}),
        ...(options.memoryEventsPath ? {memoryEventsPath: options.memoryEventsPath} : {}),
        ...(options.onOutput ? {onOutput: options.onOutput} : {}),
      },
    );
    return actionResult(result, await readResultStatus(paths.result));
  } finally {
    await endpoint.close();
    await rm(stepTemp, {recursive: true, force: true});
  }
}

function integrationGrants(
  integrations: ActionStepConfig['integrations'],
): ActionIntegrationGrant[] {
  return integrations.map((integration) => ({
    alias: integration.alias,
    connectionSlug: integration.connection_slug,
    tools: integration.tools.map((tool) => ({
      id: tool.id,
      sensitivity: tool.sensitivity,
      sensitive: tool.sensitive,
      result: tool.result,
      inputSchema: tool.input_schema,
      methods: tool.methods,
    })),
  }));
}

function inheritedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (INHERITED_ENV_KEYS.has(key) || key.startsWith('LC_')) env[key] = value;
  }
  return env;
}

function contextFile(
  step: StepDto,
  config: ActionStepConfig,
  options: ActionStepOptions,
): ActionContextFileV1 {
  return {
    context: {
      runId: options.runId,
      jobId: options.jobId,
      jobKey: config.job_key,
      stepId: step.id,
      stepKey: step.key,
      actionPath: config.action.uses,
      digest: config.action.digest,
      workspace: options.workspace,
    },
    outputs: outputDeclarations(config.outputs),
  };
}

function outputDeclarations(outputs: ActionStepConfig['outputs']): ActionOutputDeclarations {
  return Object.fromEntries(
    Object.entries(outputs).map(([name, {type, schema, required}]) => [
      name,
      {
        type,
        ...(schema === undefined ? {} : {schema}),
        ...(required === undefined ? {} : {required}),
      },
    ]),
  );
}

async function readResultStatus(path: string): Promise<ActionResultFileV1['status'] | undefined> {
  try {
    const result = JSON.parse(await readFile(path, 'utf8')) as Partial<ActionResultFileV1>;
    return result.status === 'succeeded' || result.status === 'failed' ? result.status : undefined;
  } catch {
    return undefined;
  }
}

// Keeps the outputs and annotations of the process result whatever the outcome. A signal, a spawn
// failure, or an output error already carries the right message.
function actionResult(
  result: StepResult,
  status: ActionResultFileV1['status'] | undefined,
): StepResult {
  if (result.success && status === 'succeeded') return result;
  const exitCode = result.exit_code;
  if (exitCode === null) return result;
  const message =
    status === 'failed' && exitCode !== 0
      ? `The action failed with exit code ${exitCode}.`
      : 'The action exited before it finished.';
  return {...result, success: false, error: {message, exit_code: exitCode}};
}

function failure(error: NonNullable<StepResult['error']>): StepResult {
  return {success: false, error, exit_code: null};
}

function runtimeLine(action: ActionStepConfig['action']): string {
  return `Shipfox action ${action.name} ${action.digest} · node ${process.version} · @shipfox/actions ${actionsSdkVersion()}`;
}

let sdkVersion: string | undefined;

// The runtime files sit in the package's dist directory, next to its package.json.
function actionsSdkVersion(): string {
  if (sdkVersion !== undefined) return sdkVersion;
  const packageJson = join(dirname(ACTION_BOOTSTRAP_PATH), '..', 'package.json');
  try {
    const {version} = JSON.parse(readFileSync(packageJson, 'utf8')) as {version?: unknown};
    sdkVersion = typeof version === 'string' ? version : 'unknown';
  } catch {
    sdkVersion = 'unknown';
  }
  return sdkVersion;
}
