import {createHash} from 'node:crypto';
import {MAX_WORKFLOW_FILE_BYTES} from '@shipfox/api-definitions-dto';
import {boundedMap} from '@shipfox/node-module';
import {
  type AgentDocument,
  agentKeyFromFileName,
  agentKeyIssue,
  InvalidAgentDocumentError,
  parseAgentDocument,
} from '@shipfox/workflow-document';
import yaml from 'js-yaml';
import type {ProjectAgentConfig, ProjectAgentError} from './entities/project-agent.js';
import {
  type DefinitionSyncDiagnostic,
  limitDefinitionSyncDiagnostics,
} from './entities/sync-state.js';
import {PromptFileResolutionError} from './errors.js';
import {FILE_FETCH_CONCURRENCY, isBinaryFileError} from './integrations.js';
import {resolvePromptFiles} from './resolve-prompt-files.js';
import {
  DEFAULT_WORKFLOW_PATH,
  type DiscoverWorkflowFilesParams,
  isWorkflowFile,
  listWorkflowFiles,
  noWorkflowFilesError,
  type SyncSourceContext,
} from './sync-definitions.js';

export const DEFAULT_AGENT_PATH = '.shipfox/agents/';
export const MAX_AGENT_FILES = 100;
export const INVALID_AGENT_DIAGNOSTIC_CODE = 'invalid-agent';

export interface DiscoverAgentFilesParams extends SyncSourceContext {
  ref: string;
  agentPath?: string | undefined;
}

export interface DiscoveredAgentFiles {
  /** Agent files directly in the folder. Each one names an agent. */
  paths: string[];
  /** Agent files in a subfolder. Each one is an error and names no agent. */
  nestedPaths: string[];
  /**
   * The folder holds more files than sync reads. The list is then incomplete,
   * so sync must not delete an agent on its account.
   */
  truncated: boolean;
}

/** Lists the agent files, which may be none. */
export async function listAgentFiles(
  params: DiscoverAgentFilesParams,
): Promise<DiscoveredAgentFiles> {
  const prefix = withTrailingSlash(params.agentPath ?? DEFAULT_AGENT_PATH);
  const page = await params.sourceControl.listFiles({
    workspaceId: params.workspaceId,
    connectionId: params.sourceConnectionId,
    externalRepositoryId: params.sourceExternalRepositoryId,
    ref: params.ref,
    prefix,
    limit: MAX_AGENT_FILES,
  });
  if (page.nextCursor) return {paths: [], nestedPaths: [], truncated: true};

  const paths: string[] = [];
  const nestedPaths: string[] = [];
  for (const file of page.files) {
    if (!(isWorkflowFile(file) && file.path.startsWith(prefix))) continue;
    (file.path.slice(prefix.length).includes('/') ? nestedPaths : paths).push(file.path);
  }
  return {paths, nestedPaths, truncated: false};
}

export interface DiscoverDefinitionFilesParams extends DiscoverWorkflowFilesParams {
  agentPath?: string | undefined;
}

export interface DiscoveredDefinitionFiles extends DiscoveredAgentFiles {
  workflowPaths: string[];
}

/**
 * Lists the workflow files and the agent files. A repository with only agent
 * files is a valid source, so nothing to sync is an error only when both
 * folders are empty.
 */
export async function discoverDefinitionFiles(
  params: DiscoverDefinitionFilesParams,
): Promise<DiscoveredDefinitionFiles> {
  const [workflows, agents] = await Promise.all([
    listWorkflowFiles(params),
    listAgentFiles(params),
  ]);
  if (
    workflows.paths.length === 0 &&
    agents.paths.length + agents.nestedPaths.length === 0 &&
    !agents.truncated
  ) {
    throw noWorkflowFilesError(params.workflowPath ?? DEFAULT_WORKFLOW_PATH);
  }
  return {workflowPaths: workflows.paths, ...agents};
}

/** The key an agent file names: its file name without the extension. */
export function agentKeyForPath(path: string): string {
  return agentKeyFromFileName(path.slice(path.lastIndexOf('/') + 1));
}

export type ParsedAgentFile =
  | {
      key: string;
      configPath: string;
      contentHash: string;
      valid: true;
      config: ProjectAgentConfig;
    }
  | {key: string; configPath: string; valid: false; errors: ProjectAgentError[]};

export interface FetchAndParseAgentsParams extends SyncSourceContext {
  ref: string;
  agentPath?: string | undefined;
  paths: readonly string[];
  nestedPaths: readonly string[];
  /** Called before each agent file is read. */
  onProgress?: ((path: string) => void) | undefined;
}

export interface ParsedAgents {
  /** One entry per key, valid or not. A nested file names no key and has no entry. */
  files: ParsedAgentFile[];
  diagnostics: DefinitionSyncDiagnostic[];
}

/**
 * Reads and validates each agent file on its own, so one bad file changes
 * nothing else. A file that cannot be used becomes an invalid entry and a
 * diagnostic. Only a failure to read the repository throws.
 */
export async function fetchAndParseAgents(
  params: FetchAndParseAgentsParams,
): Promise<ParsedAgents> {
  const agentPath = withTrailingSlash(params.agentPath ?? DEFAULT_AGENT_PATH);
  const parsed = await boundedMap(params.paths, FILE_FETCH_CONCURRENCY, async (path) => {
    params.onProgress?.(path);
    return await parseAgentFile(params, path);
  });

  const files: ParsedAgentFile[] = [];
  const diagnostics: DefinitionSyncDiagnostic[] = params.nestedPaths.map((path) => ({
    code: INVALID_AGENT_DIAGNOSTIC_CODE,
    message: `Agent file ${path} sits in a subfolder, so it creates no agent. Move it directly under ${agentPath}`,
    severity: 'error',
    filePath: path,
  }));

  const byKey = new Map<string, ParsedAgentEntry[]>();
  for (const entry of parsed) {
    byKey.set(entry.file.key, [...(byKey.get(entry.file.key) ?? []), entry]);
  }
  for (const [key, entries] of byKey) {
    const [only] = entries;
    if (entries.length === 1 && only !== undefined) {
      files.push(only.file);
      diagnostics.push(...only.diagnostics);
      continue;
    }

    const paths = entries.map((entry) => entry.file.configPath);
    const message = `Files ${paths.join(' and ')} both define the agent "${key}". Keep one.`;
    files.push({key, configPath: paths[0] ?? '', valid: false, errors: [{message}]});
    for (const path of paths) {
      diagnostics.push({
        code: INVALID_AGENT_DIAGNOSTIC_CODE,
        message,
        severity: 'error',
        filePath: path,
      });
    }
  }

  return {files, diagnostics: limitDefinitionSyncDiagnostics(diagnostics)};
}

interface ParsedAgentEntry {
  file: ParsedAgentFile;
  diagnostics: DefinitionSyncDiagnostic[];
}

async function parseAgentFile(
  params: FetchAndParseAgentsParams,
  path: string,
): Promise<ParsedAgentEntry> {
  const key = agentKeyForPath(path);
  const invalid = (
    errors: ProjectAgentError[],
    code = INVALID_AGENT_DIAGNOSTIC_CODE,
  ): ParsedAgentEntry => ({
    file: {key, configPath: path, valid: false, errors},
    diagnostics: errors.map((error) => ({
      code,
      message: `Invalid agent file ${path}: ${error.message}`,
      severity: 'error' as const,
      ...(error.path === undefined ? {} : {path: error.path}),
      filePath: path,
    })),
  });

  const keyIssue = agentKeyIssue(key);
  if (keyIssue !== undefined) return invalid([{message: keyIssue}]);

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
    if (isBinaryFileError(error)) return invalid([{message: 'The file is not UTF-8 text.'}]);
    throw error;
  }
  if (Buffer.byteLength(content, 'utf8') > MAX_WORKFLOW_FILE_BYTES) {
    return invalid([{message: `The file is larger than ${MAX_WORKFLOW_FILE_BYTES} bytes.`}]);
  }

  const parsed = parseAgentContent({content, key});
  if (!parsed.valid) return invalid(parsed.errors);

  const {document} = parsed;
  let promptFiles = new Map<string, string>();
  if (document.instructions !== undefined) {
    try {
      promptFiles = await resolvePromptFiles({
        ...params,
        prompts: [{prompt: document.instructions, path: 'instructions', filePath: path}],
      });
    } catch (error) {
      if (!(error instanceof PromptFileResolutionError)) throw error;
      return invalid([{message: error.message, path: error.path}], 'prompt-file-invalid');
    }
  }

  return {
    file: {
      key,
      configPath: path,
      contentHash: agentContentHash({content, promptFiles}),
      valid: true,
      config: agentConfigFrom(document, promptFiles),
    },
    diagnostics: [],
  };
}

export type ParsedAgentContent =
  | {valid: true; document: AgentDocument}
  | {valid: false; errors: ProjectAgentError[]};

/** Parses the YAML of one agent file. An empty file is an empty document. */
export function parseAgentContent(params: {content: string; key: string}): ParsedAgentContent {
  let loaded: unknown;
  try {
    loaded = yaml.load(params.content);
  } catch (error) {
    const reason = yamlErrorReason(error);
    return {valid: false, errors: [{message: `Invalid YAML syntax: ${reason}`}]};
  }
  if (loaded === undefined || loaded === null) loaded = {};
  if (typeof loaded !== 'object' || Array.isArray(loaded)) {
    return {valid: false, errors: [{message: 'An agent file must parse to an object.'}]};
  }

  try {
    return {valid: true, document: parseAgentDocument(loaded, {key: params.key})};
  } catch (error) {
    if (!(error instanceof InvalidAgentDocumentError)) throw error;
    return {
      valid: false,
      errors: error.validationError.issues.map((issue) => ({
        message: issue.message,
        ...(issue.path.length === 0 ? {} : {path: issue.path.join('.')}),
      })),
    };
  }
}

function yamlErrorReason(error: unknown): string {
  const reason = (error as {reason?: unknown}).reason;
  if (typeof reason === 'string') return reason;
  return error instanceof Error ? error.message : String(error);
}

function agentConfigFrom(
  document: AgentDocument,
  promptFiles: ReadonlyMap<string, string>,
): ProjectAgentConfig {
  return {
    ...(document.name === undefined ? {} : {name: document.name}),
    ...(document.description === undefined ? {} : {description: document.description}),
    ...(document.instructions === undefined
      ? {}
      : {instructions: joinInstructions(document.instructions, promptFiles)}),
    ...(document.provider === undefined ? {} : {provider: document.provider}),
    ...(document.model === undefined ? {} : {model: document.model}),
    ...(document.thinking === undefined ? {} : {thinking: document.thinking}),
    ...(document.integrations === undefined ? {} : {integrations: document.integrations}),
  };
}

/** Joins parts like an agent step prompt: a blank line between parts, none after a part's last line break. */
function joinInstructions(
  instructions: NonNullable<AgentDocument['instructions']>,
  promptFiles: ReadonlyMap<string, string>,
): string {
  if (typeof instructions === 'string') return instructions;
  return instructions
    .map((part) =>
      trimTrailingLineBreaks(typeof part === 'string' ? part : (promptFiles.get(part.file) ?? '')),
    )
    .join('\n\n');
}

function trimTrailingLineBreaks(text: string): string {
  let end = text.length;
  while (end > 0 && (text[end - 1] === '\n' || text[end - 1] === '\r')) end -= 1;
  return text.slice(0, end);
}

/** Hashes the YAML alone without prompt files, so a change to a prompt file alone changes the hash. */
function agentContentHash(params: {
  content: string;
  promptFiles: ReadonlyMap<string, string>;
}): string {
  if (params.promptFiles.size === 0) return sha256Hex(params.content);
  const promptFiles = [...params.promptFiles]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, text]) => [file, sha256Hex(text)]);
  return sha256Hex(JSON.stringify({content: params.content, promptFiles}));
}

function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function withTrailingSlash(path: string): string {
  return path.endsWith('/') ? path : `${path}/`;
}
