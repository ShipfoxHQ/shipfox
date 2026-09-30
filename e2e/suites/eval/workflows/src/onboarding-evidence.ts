import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  shippedTemplateLoader,
  type TemplateLoader,
  type WorkflowTemplateManifest,
} from '@shipfox/workflow-templates';
import {parse as parseYaml} from 'yaml';
import {
  type DryRunOutcome,
  type OnboardingEvidence,
  primaryWorkflowFile,
} from './onboarding-checks.js';
import type {OnboardingExpect} from './onboarding-schema.js';
import type {WrittenFile} from './onboarding-workspace.js';

const MAX_MODEL_PAGES = 50;
const MAX_LISTED_ERRORS = 3;

/** A tool result in the agent-access envelope: `ok` with a result, or an error with a code. */
export type ToolEnvelope =
  | {ok: true; result: unknown}
  | {ok: false; error: {code: string; message?: string; details?: unknown}};

/** What the runner needs to call a tool of the stack's MCP server, so tests can fake it. */
export interface ToolCaller {
  call(name: string, args: Record<string, unknown>): Promise<ToolEnvelope>;
  close(): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textEnvelope(result: Record<string, unknown>): unknown {
  const text = Array.isArray(result.content) ? result.content.find(isRecord)?.text : undefined;
  if (typeof text !== 'string') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    // The tool answered with text that is not an envelope.
    return undefined;
  }
}

function envelopeFrom(candidate: unknown): ToolEnvelope | undefined {
  if (!(isRecord(candidate) && typeof candidate.ok === 'boolean')) return undefined;
  if (candidate.ok) return {ok: true, result: candidate.result};
  const error = isRecord(candidate.error) ? candidate.error : {};
  return {
    ok: false,
    error: {
      code: typeof error.code === 'string' ? error.code : 'unknown',
      ...(typeof error.message === 'string' ? {message: error.message} : {}),
      ...(error.details === undefined ? {} : {details: error.details}),
    },
  };
}

/** Reads the envelope from a tool result's structured content, or from its JSON text. */
export function parseEnvelope(result: unknown): ToolEnvelope {
  if (!isRecord(result)) return {ok: false, error: {code: 'unparseable'}};
  return (
    envelopeFrom(result.structuredContent) ??
    envelopeFrom(textEnvelope(result)) ?? {ok: false, error: {code: 'unparseable'}}
  );
}

/** Connects to the recording proxy the way the agent does, with its own MCP session. */
export async function connectToolCaller(url: string): Promise<ToolCaller> {
  const client = new Client({name: 'eval-checker', version: '0.0.0'});
  await client.connect(new StreamableHTTPClientTransport(new URL(url)) as never);
  return {
    call: async (name, args) => parseEnvelope(await client.callTool({name, arguments: args})),
    close: () => client.close(),
  };
}

function describeFailure(envelope: ToolEnvelope): string {
  if (envelope.ok) return 'check_passed was not true';
  const details = isRecord(envelope.error.details) ? envelope.error.details : {};
  const errors = Array.isArray(details.errors)
    ? details.errors
        .filter(isRecord)
        .slice(0, MAX_LISTED_ERRORS)
        .map((error) => `${String(error.path ?? '')} ${String(error.message ?? '')}`.trim())
    : [];
  return [envelope.error.code, envelope.error.message, ...errors].filter(Boolean).join(': ');
}

function triggerKeys(yaml: string): string[] | undefined {
  try {
    const document: unknown = parseYaml(yaml);
    const triggers = isRecord(document) ? document.triggers : undefined;
    return isRecord(triggers) ? Object.keys(triggers) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Checks the written workflow with `create_dev_run` in dry-run mode, once for each of its
 * triggers, as the validation skill does. A dry run checks the definition and the trigger key
 * and starts nothing.
 */
export async function runDryRuns({
  caller,
  projectId,
  file,
}: {
  caller: ToolCaller;
  projectId: string;
  file: WrittenFile;
}): Promise<DryRunOutcome[]> {
  const triggers = triggerKeys(file.content);
  if (triggers === undefined || triggers.length === 0) {
    return [{trigger: '-', passed: false, detail: 'The workflow declares no triggers to check.'}];
  }
  const outcomes: DryRunOutcome[] = [];
  for (const trigger of triggers) {
    const envelope = await caller.call('create_dev_run', {
      project_id: projectId,
      config_path: file.path,
      trigger,
      content: file.content,
      dry_run: true,
    });
    const passed =
      envelope.ok && isRecord(envelope.result) && envelope.result.check_passed === true;
    outcomes.push({
      trigger,
      passed,
      ...(passed ? {} : {detail: describeFailure(envelope)}),
    });
  }
  return outcomes;
}

function modelPage(envelope: ToolEnvelope): {ids: string[]; next: string | undefined} {
  if (!(envelope.ok && isRecord(envelope.result))) {
    throw new Error(`list_workspace_models failed: ${describeFailure(envelope)}`);
  }
  const models = Array.isArray(envelope.result.models) ? envelope.result.models : [];
  const next = envelope.result.next_cursor;
  return {
    ids: models.filter(isRecord).flatMap(({id}) => (typeof id === 'string' ? [id] : [])),
    next: typeof next === 'string' ? next : undefined,
  };
}

/** The ids of the models the workspace can run, which are the catalog a workflow may name. */
export async function listWorkspaceModelIds(caller: ToolCaller): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_MODEL_PAGES; page += 1) {
    const result = modelPage(await caller.call('list_workspace_models', cursor ? {cursor} : {}));
    ids.push(...result.ids);
    if (result.next === undefined) return ids;
    cursor = result.next;
  }
  throw new Error(`list_workspace_models has more than ${MAX_MODEL_PAGES} pages.`);
}

function defaultOptions(manifest: WorkflowTemplateManifest): Record<string, string> {
  return Object.fromEntries(
    manifest.options.flatMap(({id, choices}) => {
      const choice = choices.find(({default: isDefault}) => isDefault === true) ?? choices[0];
      return choice === undefined ? [] : [[id, choice.id]];
    }),
  );
}

/**
 * The variant the agent should have written: the template composed with the case's bindings, and
 * with its options applied. Options the case leaves out take the manifest default, because an
 * agent that does not ask about an option leaves the template's own choice.
 */
export async function composeExpectedVariant({
  expected,
  loader = shippedTemplateLoader,
}: {
  expected: OnboardingExpect;
  loader?: TemplateLoader;
}): Promise<string> {
  const template = expected.template;
  if (template === undefined) throw new Error('The case names no template to compose.');
  const found = await loader.get({package: template});
  if (found === undefined) throw new Error(`The template loader does not serve ${template}.`);
  const composed = await loader.compose({
    package: template,
    bindings: expected.bindings ?? {},
    options: {...defaultOptions(found.manifest), ...expected.options},
  });
  if (composed === undefined) throw new Error(`The template loader does not serve ${template}.`);
  return composed;
}

export interface CollectEvidenceOptions {
  expected: OnboardingExpect;
  files: WrittenFile[];
  projectId: string;
  /** The recording proxy's MCP endpoint of the case's workspace. */
  mcpUrl: string;
  loader?: TemplateLoader;
  connect?: (url: string) => Promise<ToolCaller>;
}

/**
 * Gathers what the graders cannot read from the session: the dry run of the written workflow, the
 * workspace's models, and the expected template variant. Only a `validated` outcome that wrote a
 * file needs them. The caller must read the agent's MCP call log first, since these calls go
 * through the same proxy and would show up in it.
 */
export async function collectOnboardingEvidence(
  options: CollectEvidenceOptions,
): Promise<OnboardingEvidence> {
  const file = primaryWorkflowFile(options.files);
  if (options.expected.outcome !== 'validated' || file === undefined) return {};

  const evidence: OnboardingEvidence = {};
  if (options.expected.template !== undefined) {
    evidence.expected_yaml = await composeExpectedVariant({
      expected: options.expected,
      ...(options.loader === undefined ? {} : {loader: options.loader}),
    });
  }
  const caller = await (options.connect ?? connectToolCaller)(options.mcpUrl);
  try {
    evidence.dry_runs = await runDryRuns({caller, projectId: options.projectId, file});
    evidence.workspace_models = await listWorkspaceModelIds(caller);
  } finally {
    await caller.close().catch(() => undefined);
  }
  return evidence;
}
