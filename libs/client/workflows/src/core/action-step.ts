import type {WorkflowRun} from './entities/workflow-run.js';

export type ActionToolSensitivity = 'read' | 'write';

export interface ActionGrantedTool {
  id: string;
  sensitivity: ActionToolSensitivity;
  result: 'json' | 'file';
  methods?: readonly {id: string; sensitivity: ActionToolSensitivity}[] | undefined;
}

export interface ActionBinding {
  alias: string;
  provider: string;
  connectionSlug: string;
  connectionId: string | null;
  tools: ActionGrantedTool[];
}

/** What a dispatched action step config says about the action, its inputs, and its grants. */
export interface ActionStepConfig {
  name: string | null;
  uses: string;
  digest: string | null;
  inputs: Record<string, unknown>;
  /** Input name to secret key. Secret values never reach the config, only these references. */
  secretInputs: ReadonlyMap<string, string>;
  bindings: ActionBinding[];
}

export interface ActionRuntime {
  node: string;
  sdk: string;
}

const SHORT_DIGEST_HEX_LENGTH = 12;
// The runner's first log line: `Shipfox action <name> <digest> · node <version> · @shipfox/actions <version>`.
const RUNTIME_LINE_PATTERN = /^Shipfox action .* · node (\S+) · @shipfox\/actions (\S+)\s*$/u;

export function readActionStepConfig(
  config: Record<string, unknown> | null | undefined,
): ActionStepConfig | null {
  const action = asRecord(config?.action);
  const uses = stringValue(action?.uses);
  if (!action || !uses) return null;
  return {
    name: stringValue(action.name),
    uses,
    digest: stringValue(action.digest),
    inputs: asRecord(config?.inputs) ?? {},
    secretInputs: readSecretInputs(config?.secret_bindings),
    bindings: Array.isArray(config?.integrations) ? config.integrations.flatMap(toBinding) : [],
  };
}

/** Resolved inputs for display: a secret-bound input shows its reference, never a value. */
export function presentedActionInputs(config: ActionStepConfig): Record<string, unknown> {
  const inputs: Record<string, unknown> = {...config.inputs};
  for (const [name, key] of config.secretInputs) inputs[name] = `*** (secrets.${key})`;
  return inputs;
}

export function shortActionDigest(digest: string): string {
  const [algorithm, hex] = digest.includes(':') ? digest.split(':', 2) : [null, digest];
  const short = (hex ?? '').slice(0, SHORT_DIGEST_HEX_LENGTH);
  return algorithm ? `${algorithm}:${short}` : short;
}

/** Reads the runtime and SDK versions from the first line the runner writes for an action. */
export function readActionRuntime(
  records: readonly {type: string; data?: unknown}[],
): ActionRuntime | null {
  const first = records.find((record) => record.type === 'output');
  if (typeof first?.data !== 'string') return null;
  const match = RUNTIME_LINE_PATTERN.exec(first.data.split('\n', 1)[0] ?? '');
  if (!match?.[1] || !match[2]) return null;
  return {node: match[1], sdk: match[2]};
}

function readSecretInputs(value: unknown): ReadonlyMap<string, string> {
  const inputs = new Map<string, string>();
  if (!Array.isArray(value)) return inputs;
  for (const binding of value) {
    const record = asRecord(binding);
    const target = asRecord(record?.target);
    const name = target?.kind === 'input' ? stringValue(target.name) : null;
    const key = stringValue(record?.key) ?? secretSegmentKey(record?.segments);
    if (name && key) inputs.set(name, key);
  }
  return inputs;
}

function secretSegmentKey(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  for (const segment of value) {
    const record = asRecord(segment);
    if (record?.kind === 'secret') return stringValue(record.key);
  }
  return null;
}

function toBinding(value: unknown): ActionBinding[] {
  const record = asRecord(value);
  const alias = stringValue(record?.alias);
  const provider = stringValue(record?.provider);
  const connectionSlug = stringValue(record?.connection_slug);
  if (!record || !alias || !provider || !connectionSlug) return [];
  return [
    {
      alias,
      provider,
      connectionSlug,
      connectionId: stringValue(record.connection_id),
      tools: Array.isArray(record.tools) ? record.tools.flatMap(toGrantedTool) : [],
    },
  ];
}

function toGrantedTool(value: unknown): ActionGrantedTool[] {
  const record = asRecord(value);
  const id = stringValue(record?.id);
  if (!record || !id || !isSensitivity(record.sensitivity)) return [];
  const methods = Array.isArray(record.methods) ? record.methods.flatMap(toMethod) : undefined;
  return [
    {
      id,
      sensitivity: record.sensitivity,
      result: record.result === 'file' ? 'file' : 'json',
      ...(methods === undefined ? {} : {methods}),
    },
  ];
}

function toMethod(value: unknown): {id: string; sensitivity: ActionToolSensitivity}[] {
  const record = asRecord(value);
  const id = stringValue(record?.id);
  if (!record || !id || !isSensitivity(record.sensitivity)) return [];
  return [{id, sensitivity: record.sensitivity}];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function isSensitivity(value: unknown): value is ActionToolSensitivity {
  return value === 'read' || value === 'write';
}

const SHORT_COMMIT_LENGTH = 7;

/**
 * Where the action code came from. A dev run pins the commit it read actions from. A synced
 * run's snapshot commit is not on the run, and its trigger commit may be a pull request head
 * the snapshot never came from, so it has no label.
 */
export function actionSourceLabel(run: Pick<WorkflowRun, 'origin' | 'devSource'>): string | null {
  if (run.origin !== 'dev' || !run.devSource) return null;
  return run.devSource.commit.slice(0, SHORT_COMMIT_LENGTH);
}
