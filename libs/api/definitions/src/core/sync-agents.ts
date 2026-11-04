import {createHash} from 'node:crypto';
import type {AgentValidationCatalogV2} from '@shipfox/api-agent-dto/inter-module';
import {MAX_WORKFLOW_FILE_BYTES} from '@shipfox/api-definitions-dto';
import {boundedMap} from '@shipfox/node-module';
import {
  AGENT_DOCUMENT_DEFAULT_KEY,
  AGENT_DOCUMENT_KEY_PATTERN,
  type AgentDocument,
  agentDocumentKeyForPath,
  InvalidAgentDocumentError,
  parseAgentDocument,
} from '@shipfox/workflow-document';
import yaml from 'js-yaml';
import type {IntegrationValidationContext} from './entities/integration-context.js';
import type {ProjectAgentError} from './entities/project-agent.js';
import type {DefinitionSyncDiagnostic} from './entities/sync-state.js';
import type {ValidationDiagnostic} from './entities/validation-diagnostic.js';
import {PromptFileResolutionError} from './errors.js';
import {FILE_FETCH_CONCURRENCY, isBinaryFileError} from './integrations.js';
import {type PromptFileUse, resolvePromptFiles} from './resolve-prompt-files.js';
import {DEFAULT_AGENT_PATH, type SyncSourceContext, withTrailingSlash} from './sync-definitions.js';
import type {WorkflowModelValidationIssue} from './workflow-model/invalid-workflow-model-error.js';
import {validateAgentFileIntegrations} from './workflow-model/normalize-agent-integrations.js';
import {validateAgentModelSelection} from './workflow-model/validate-agent-model-selection.js';
import {
  type InteractionRequestSchemas,
  validateAgentRules,
} from './workflow-model/validate-agent-rules.js';

export const AGENT_FILE_INVALID_CODE = 'agent-file-invalid';
// Server-side agent turns run on pi, so an agent file is checked against it.
const AGENT_HARNESS = 'pi';
const TRAILING_LINE_BREAKS_RE = /(?:\r?\n)+$/;

export interface ParsedAgent {
  key: string;
  path: string;
  name: string | null;
  description: string | null;
  /** The joined instructions, with each `file` part inlined. */
  instructions: string | null;
  document: AgentDocument;
  contentHash: string;
}

export interface InvalidAgent {
  key: string;
  path: string;
  error: ProjectAgentError;
}

export interface ParsedAgents {
  valid: ParsedAgent[];
  /** Files with a key whose content failed. Their rows keep the last valid version. */
  invalid: InvalidAgent[];
  /** Every error and warning, including files that get no row. */
  diagnostics: DefinitionSyncDiagnostic[];
}

export interface FetchAndParseAgentsParams extends SyncSourceContext {
  ref: string;
  paths: string[];
  agentPath?: string | undefined;
  agentValidationCatalog: AgentValidationCatalogV2;
  /** Without it, the `integrations` of an agent file are not checked against the workspace. */
  loadIntegrationValidationContext?: (() => Promise<IntegrationValidationContext>) | undefined;
  /** Without it, the filters of `on` rules are checked for syntax only. */
  loadInteractionRequestSchemas?: (() => Promise<InteractionRequestSchemas>) | undefined;
  onProgress?: ((path: string) => void) | undefined;
}

/**
 * Reads and validates each agent file on its own. A file that fails never
 * stops the others: its errors become diagnostics, and a file with a key is
 * reported as invalid so its row keeps the last valid version.
 */
export async function fetchAndParseAgents(
  params: FetchAndParseAgentsParams,
): Promise<ParsedAgents> {
  const agentPath = withTrailingSlash(params.agentPath ?? DEFAULT_AGENT_PATH);
  const result: ParsedAgents = {valid: [], invalid: [], diagnostics: []};
  const seenKeys = new Map<string, string>();
  const integrationValidationContext = once(params.loadIntegrationValidationContext);
  const interactionRequestSchemas = once(params.loadInteractionRequestSchemas);

  const outcomes = await boundedMap(
    params.paths,
    FILE_FETCH_CONCURRENCY,
    async (path) => {
      params.onProgress?.(path);
      return await parseAgentFile({
        ...params,
        path,
        agentPath,
        integrationValidationContext,
        interactionRequestSchemas,
      });
    },
    {stopOnError: true},
  );

  for (const outcome of outcomes) {
    if (outcome.key !== undefined) {
      const first = seenKeys.get(outcome.key);
      if (first !== undefined) {
        result.diagnostics.push(
          diagnostic({
            message: `Agent file ${outcome.path} is ignored: ${first} already defines the agent "${outcome.key}".`,
            filePath: outcome.path,
          }),
          ...outcome.diagnostics,
        );
        continue;
      }
      seenKeys.set(outcome.key, outcome.path);
    }
    if (outcome.agent !== undefined) {
      result.valid.push(outcome.agent);
      result.diagnostics.push(...outcome.diagnostics);
      continue;
    }
    result.diagnostics.push(...outcome.diagnostics);
    if (outcome.key !== undefined) {
      result.invalid.push({
        key: outcome.key,
        path: outcome.path,
        error: {
          message: outcome.diagnostics[0]?.message ?? `Agent file ${outcome.path} is invalid.`,
          diagnostics: outcome.diagnostics.map(({filePath: _filePath, ...rest}) => rest),
        },
      });
    }
  }

  return result;
}

interface AgentFileOutcome {
  path: string;
  key: string | undefined;
  agent: ParsedAgent | undefined;
  diagnostics: DefinitionSyncDiagnostic[];
}

/** Runs `load` on first use only, and only if something needs its result. */
function once<T>(load: (() => Promise<T>) | undefined): () => Promise<T | undefined> {
  let pending: Promise<T> | undefined;
  return async () => {
    if (load === undefined) return undefined;
    pending ??= load();
    return await pending;
  };
}

async function parseAgentFile(
  params: FetchAndParseAgentsParams & {
    path: string;
    agentPath: string;
    integrationValidationContext: () => Promise<IntegrationValidationContext | undefined>;
    interactionRequestSchemas: () => Promise<InteractionRequestSchemas | undefined>;
  },
): Promise<AgentFileOutcome> {
  const {path} = params;
  const key = agentDocumentKeyForPath(path, params.agentPath);
  const fail = (diagnostics: DefinitionSyncDiagnostic[]): AgentFileOutcome => ({
    path,
    key,
    agent: undefined,
    diagnostics,
  });
  if (key === undefined)
    return fail([diagnostic({message: keyIssue(path, params.agentPath), filePath: path})]);

  const read = await readAgentFile(params);
  if (typeof read !== 'string') return fail([read]);
  const content = read;

  let document: AgentDocument;
  try {
    document = parseAgentDocument(loadYaml(content), {key});
  } catch (error) {
    if (error instanceof InvalidAgentDocumentError) {
      return fail(
        error.validationError.issues.map((issue) =>
          diagnostic({
            message: issue.message,
            path: issue.path.map(String).join('.') || undefined,
            filePath: path,
          }),
        ),
      );
    }
    if (error instanceof AgentYamlError) {
      return fail([diagnostic({message: error.message, filePath: path})]);
    }
    throw error;
  }

  const references = promptFileUses(document, path);
  let promptFiles: Map<string, string>;
  try {
    promptFiles = await resolvePromptFiles({...params, references});
  } catch (error) {
    if (!(error instanceof PromptFileResolutionError)) throw error;
    return fail([diagnostic({message: error.message, path: error.path, filePath: path})]);
  }

  const instructions = joinInstructions(document, promptFiles);
  if (key !== AGENT_DOCUMENT_DEFAULT_KEY && !instructions?.trim()) {
    return fail([
      diagnostic({
        message: 'A custom agent requires "instructions" that are not blank.',
        path: 'instructions',
        filePath: path,
      }),
    ]);
  }

  const diagnostics = await validateAgentDocument({
    document,
    path,
    agentValidationCatalog: params.agentValidationCatalog,
    integrationValidationContext: params.integrationValidationContext,
    interactionRequestSchemas: params.interactionRequestSchemas,
  });
  if (diagnostics.some((entry) => entry.severity === 'error')) return fail(diagnostics);

  return {
    path,
    key,
    diagnostics,
    agent: {
      key,
      path,
      name: document.name ?? null,
      description: document.description ?? null,
      instructions,
      document,
      contentHash: agentContentHash({content, references, promptFiles}),
    },
  };
}

/** Checks what the schema cannot: the model, the thinking level, and the integrations. */
async function validateAgentDocument(params: {
  document: AgentDocument;
  path: string;
  agentValidationCatalog: AgentValidationCatalogV2;
  integrationValidationContext: () => Promise<IntegrationValidationContext | undefined>;
  interactionRequestSchemas: () => Promise<InteractionRequestSchemas | undefined>;
}): Promise<DefinitionSyncDiagnostic[]> {
  const {document} = params;
  const issues: WorkflowModelValidationIssue[] = [];
  validateAgentModelSelection({
    selection: {...document, harness: AGENT_HARNESS},
    path: [],
    issues,
    validateLiteralModel: true,
    validateLiteralProvider: true,
    agentValidationCatalog: params.agentValidationCatalog,
  });
  validateThinking(document, params.agentValidationCatalog, issues);
  const needsContext = document.integrations !== undefined || document.on !== undefined;
  const integrationValidationContext = needsContext
    ? await params.integrationValidationContext()
    : undefined;
  if (integrationValidationContext !== undefined) {
    validateAgentFileIntegrations({
      integrations: document.integrations,
      integrationValidationContext,
      issues,
    });
  }
  validateAgentRules({
    rules: document.on,
    integrationValidationContext,
    requestSchemas:
      document.on === undefined ? undefined : await params.interactionRequestSchemas(),
    issues,
  });
  return issues.map((issue) =>
    diagnostic({
      code: issue.code,
      message: issue.message,
      path: issue.path.join('.') || undefined,
      severity: issue.severity,
      filePath: params.path,
    }),
  );
}

async function readAgentFile(
  params: FetchAndParseAgentsParams & {path: string},
): Promise<string | DefinitionSyncDiagnostic> {
  const {path} = params;
  let content: string;
  try {
    ({content} = await params.sourceControl.fetchFile({
      workspaceId: params.workspaceId,
      connectionId: params.sourceConnectionId,
      externalRepositoryId: params.sourceExternalRepositoryId,
      ref: params.ref,
      path,
    }));
  } catch (error) {
    if (!isBinaryFileError(error)) throw error;
    return diagnostic({message: `Agent file is not UTF-8 text: ${path}`, filePath: path});
  }
  if (Buffer.byteLength(content, 'utf8') > MAX_WORKFLOW_FILE_BYTES) {
    return diagnostic({
      message: `Agent file is larger than ${MAX_WORKFLOW_FILE_BYTES} bytes: ${path}`,
      filePath: path,
    });
  }
  return content;
}

function keyIssue(path: string, agentPath: string): string {
  const fileName = path.slice(agentPath.length);
  if (fileName.includes('/')) {
    return `Agent file ${path} is nested. Agent files must sit directly in ${agentPath}.`;
  }
  return `Agent file ${path} has an invalid name. The name before the extension must match ${AGENT_DOCUMENT_KEY_PATTERN.source}.`;
}

function promptFileUses(document: AgentDocument, filePath: string): PromptFileUse[] {
  if (!Array.isArray(document.instructions)) return [];
  return document.instructions.flatMap((part, index) =>
    typeof part === 'string' ? [] : [{file: part.file, path: `instructions.${index}`, filePath}],
  );
}

function joinInstructions(
  document: AgentDocument,
  promptFiles: ReadonlyMap<string, string>,
): string | null {
  const {instructions} = document;
  if (instructions === undefined) return null;
  if (typeof instructions === 'string') return instructions;
  return instructions
    .map((part) =>
      trimTrailingLineBreaks(typeof part === 'string' ? part : (promptFiles.get(part.file) ?? '')),
    )
    .join('\n\n');
}

function trimTrailingLineBreaks(text: string): string {
  return text.replace(TRAILING_LINE_BREAKS_RE, '');
}

function validateThinking(
  document: AgentDocument,
  catalog: AgentValidationCatalogV2,
  issues: WorkflowModelValidationIssue[],
): void {
  if (document.thinking === undefined) return;
  const levels =
    catalog.harnesses.find((entry) => entry.id === AGENT_HARNESS)?.thinking_levels ?? [];
  if ((levels as readonly string[]).includes(document.thinking)) return;
  issues.push({
    code: 'harness-thinking-incompatible',
    message: `Harness "${AGENT_HARNESS}" does not support thinking: ${document.thinking}. Supported levels: ${levels.join(', ')}.`,
    path: ['thinking'],
    severity: 'error',
    scope: 'definition',
  });
}

/**
 * Hashes the YAML alone when the file names no prompt file. Otherwise the
 * prompt file digests join the hash, so a commit that changes only a prompt
 * file still produces a new version.
 */
function agentContentHash(params: {
  content: string;
  references: readonly PromptFileUse[];
  promptFiles: ReadonlyMap<string, string>;
}): string {
  const files = [...new Set(params.references.map((use) => use.file))].sort();
  if (files.length === 0) return sha256Hex(params.content);
  const promptFiles = files.map((file) => [file, sha256Hex(params.promptFiles.get(file) ?? '')]);
  return sha256Hex(JSON.stringify({content: params.content, promptFiles}));
}

function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

class AgentYamlError extends Error {}

function yamlErrorReason(error: unknown): string {
  const reason = (error as {reason?: unknown} | null)?.reason;
  if (typeof reason === 'string') return reason;
  return error instanceof Error ? error.message : String(error);
}

function loadYaml(source: string): unknown {
  let parsed: unknown;
  try {
    parsed = yaml.load(source);
  } catch (error) {
    throw new AgentYamlError(`Invalid agent YAML syntax: ${yamlErrorReason(error)}`);
  }
  // An empty file is a valid `shippy.yaml`: it configures nothing.
  if (parsed === null || parsed === undefined) return {};
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AgentYamlError('Agent YAML must parse to an object.');
  }
  return parsed;
}

function diagnostic(params: {
  code?: string | undefined;
  message: string;
  path?: string | undefined;
  severity?: ValidationDiagnostic['severity'] | undefined;
  filePath: string;
}): DefinitionSyncDiagnostic {
  return {
    code: params.code ?? AGENT_FILE_INVALID_CODE,
    message: params.message,
    severity: params.severity ?? 'error',
    ...(params.path === undefined ? {} : {path: params.path}),
    filePath: params.filePath,
  };
}
