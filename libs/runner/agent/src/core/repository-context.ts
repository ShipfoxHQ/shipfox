import type {Dirent} from 'node:fs';
import {open, readdir, readFile, realpath, stat} from 'node:fs/promises';
import {dirname, join, relative, resolve, sep} from 'node:path';
import {parseFrontmatter} from '@earendil-works/pi-coding-agent';
import {
  AGENT_REPOSITORY_INSTRUCTION_FILE_NAMES,
  AGENT_REPOSITORY_INSTRUCTIONS_MAX_BYTES,
  AGENT_REPOSITORY_SKILL_DIRECTORIES,
  type AgentRepositoryContextConfigDto,
  type Harness,
} from '@shipfox/api-agent-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {AgentConfigError} from '#core/errors.js';

export const MAX_REPOSITORY_INSTRUCTIONS_BYTES = AGENT_REPOSITORY_INSTRUCTIONS_MAX_BYTES;
export const REPOSITORY_INSTRUCTIONS_HEADER =
  'Repository instructions; they do not override the task above:';
export const REPOSITORY_CONTEXT_SESSION_ENTRY_TYPE = 'shipfox_repository_context';

const SKILL_DIRECTORIES = AGENT_REPOSITORY_SKILL_DIRECTORIES.map((directory) =>
  join(...directory.split('/')),
);
const SKILL_FILE_NAME = 'SKILL.md';

export type RepositoryContextConfig = AgentRepositoryContextConfigDto;

export const DEFAULT_REPOSITORY_CONTEXT_CONFIG: RepositoryContextConfig = {
  instructions: true,
  skills: true,
};

export interface RepositoryInstructionFile {
  readonly path: string;
  /** Path relative to the repository root, with `/` separators. */
  readonly displayPath: string;
  readonly content: string;
  readonly bytes: number;
  readonly truncated: boolean;
}

export interface RepositorySkill {
  readonly name: string;
  readonly description: string;
  readonly directory: string;
  readonly filePath: string;
  /** Directory relative to the repository root, with `/` separators. */
  readonly displayPath: string;
}

export interface RepositoryContext {
  readonly config: RepositoryContextConfig;
  readonly instructionFiles: readonly RepositoryInstructionFile[];
  readonly skills: readonly RepositorySkill[];
}

/**
 * Reads the repository files that every harness gives the agent: instruction files and skills
 * from the repository root down to the working directory. It never reads harness settings,
 * hooks, MCP configuration, extensions, or anything outside the repository.
 */
export async function resolveRepositoryContext(params: {
  readonly cwd: string;
  readonly harness: Harness;
  readonly config: RepositoryContextConfig;
}): Promise<RepositoryContext> {
  const cwd = resolve(params.cwd);
  const root = await findRepositoryRoot(cwd);
  const directories = directoriesFromRoot(root, cwd);
  const instructionFiles = params.config.instructions
    ? await readInstructionFiles({
        root,
        directories,
        fileNames: AGENT_REPOSITORY_INSTRUCTION_FILE_NAMES[params.harness],
      })
    : [];
  const skills =
    params.config.skills === false
      ? []
      : selectSkills(await discoverSkills(root, directories), params.config.skills);
  return {config: params.config, instructionFiles, skills};
}

/** Appends repository instructions to the step prompt as advisory text. */
export function withRepositoryInstructions(prompt: string, context: RepositoryContext): string {
  if (context.instructionFiles.length === 0) return prompt;
  const files = context.instructionFiles
    .map((file) => `From ${file.displayPath}:\n\n${file.content}`)
    .join('\n\n');
  return `${prompt}\n\n${REPOSITORY_INSTRUCTIONS_HEADER}\n\n${files}`;
}

/** A session entry that records what the step loaded, shown in the session view. */
export function repositoryContextSessionEntry(context: RepositoryContext): string {
  return JSON.stringify({
    type: REPOSITORY_CONTEXT_SESSION_ENTRY_TYPE,
    timestamp: new Date().toISOString(),
    instructionsEnabled: context.config.instructions,
    skillsEnabled: context.config.skills !== false,
    instructions: context.instructionFiles.map((file) => ({
      path: file.displayPath,
      bytes: file.bytes,
      truncated: file.truncated,
    })),
    skills: context.skills.map((skill) => ({name: skill.name, path: skill.displayPath})),
  });
}

export function logRepositoryContext(params: {
  readonly context: RepositoryContext;
  readonly harness: string;
  readonly stepId?: string | undefined;
  readonly attempt?: number | undefined;
}): void {
  const {context} = params;
  logger().info(
    {
      event: 'runner.agent_repository_context',
      harness: params.harness,
      stepId: params.stepId,
      attempt: params.attempt,
      instructionsEnabled: context.config.instructions,
      skillsEnabled: context.config.skills !== false,
      instructionFiles: context.instructionFiles.map((file) => ({
        path: file.displayPath,
        bytes: file.bytes,
        truncated: file.truncated,
      })),
      skills: context.skills.map((skill) => skill.name),
    },
    'Agent repository context resolved',
  );
}

async function findRepositoryRoot(cwd: string): Promise<string> {
  let directory = cwd;
  while (true) {
    if (await pathExists(join(directory, '.git'))) return directory;
    const parent = dirname(directory);
    // Without a Git root, stay in the working directory instead of reading the runner's parents.
    if (parent === directory) return cwd;
    directory = parent;
  }
}

function directoriesFromRoot(root: string, cwd: string): string[] {
  const path = relative(root, cwd);
  if (path === '') return [root];
  const directories = [root];
  let current = root;
  for (const part of path.split(sep)) {
    current = join(current, part);
    directories.push(current);
  }
  return directories;
}

async function readInstructionFiles(params: {
  readonly root: string;
  readonly directories: readonly string[];
  readonly fileNames: readonly string[];
}): Promise<RepositoryInstructionFile[]> {
  const files: RepositoryInstructionFile[] = [];
  let remainingBytes = MAX_REPOSITORY_INSTRUCTIONS_BYTES;
  for (const directory of params.directories) {
    if (remainingBytes === 0) break;
    const file = await readDirectoryInstructionFile({
      root: params.root,
      directory,
      fileNames: params.fileNames,
      maxBytes: remainingBytes,
    });
    if (file === undefined) continue;
    files.push(file);
    remainingBytes -= Buffer.byteLength(file.content);
    if (file.truncated) {
      logger().warn(
        {path: file.path, maxBytes: MAX_REPOSITORY_INSTRUCTIONS_BYTES},
        'Repository instructions were truncated before agent invocation',
      );
      break;
    }
  }
  return files;
}

async function readDirectoryInstructionFile(params: {
  readonly root: string;
  readonly directory: string;
  readonly fileNames: readonly string[];
  readonly maxBytes: number;
}): Promise<RepositoryInstructionFile | undefined> {
  for (const name of params.fileNames) {
    const path = join(params.directory, name);
    let bytes: Buffer;
    try {
      bytes = await readBoundedFile(path, params.maxBytes + 1);
    } catch (error) {
      if (!isMissingFileError(error)) {
        logger().warn({err: error, path}, 'Repository instruction file could not be read');
      }
      continue;
    }
    if (bytes.toString('utf8').trim().length === 0) continue;
    const truncated = bytes.byteLength > params.maxBytes;
    const content = truncated
      ? new TextDecoder('utf-8').decode(bytes.subarray(0, params.maxBytes), {stream: true})
      : bytes.toString('utf8');
    return {
      path,
      displayPath: displayPath(params.root, path),
      content,
      bytes: bytes.byteLength,
      truncated,
    };
  }
  return undefined;
}

async function readBoundedFile(path: string, maxBytes: number): Promise<Buffer> {
  const file = await open(path, 'r');
  const bytes = Buffer.alloc(maxBytes);
  let bytesRead = 0;
  try {
    while (bytesRead < bytes.length) {
      const result = await file.read(bytes, bytesRead, bytes.length - bytesRead, bytesRead);
      if (result.bytesRead === 0) break;
      bytesRead += result.bytesRead;
    }
    return bytes.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
}

// Directories closer to the working directory win a name collision, and `.agents/skills` wins
// over `.claude/skills` in the same directory, which is often a link to it.
async function discoverSkills(
  root: string,
  directories: readonly string[],
): Promise<RepositorySkill[]> {
  const skills: RepositorySkill[] = [];
  const names = new Set<string>();
  const files = new Set<string>();
  for (const directory of [...directories].reverse()) {
    for (const skillDirectory of SKILL_DIRECTORIES) {
      for (const skill of await readSkillDirectory(root, join(directory, skillDirectory))) {
        const canonicalFile = await realpath(skill.filePath).catch(() => skill.filePath);
        if (names.has(skill.name) || files.has(canonicalFile)) continue;
        names.add(skill.name);
        files.add(canonicalFile);
        skills.push(skill);
      }
    }
  }
  return skills;
}

async function readSkillDirectory(root: string, directory: string): Promise<RepositorySkill[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(directory, {withFileTypes: true});
  } catch (error) {
    if (!isMissingFileError(error)) {
      logger().warn({err: error, path: directory}, 'Repository skill directory could not be read');
    }
    return [];
  }
  const skills: RepositorySkill[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name.startsWith('.') || !(entry.isDirectory() || entry.isSymbolicLink())) continue;
    const skill = await readSkill(root, join(directory, entry.name), entry.name);
    if (skill !== undefined) skills.push(skill);
  }
  return skills;
}

async function readSkill(
  root: string,
  directory: string,
  directoryName: string,
): Promise<RepositorySkill | undefined> {
  const filePath = join(directory, SKILL_FILE_NAME);
  let content: string;
  try {
    content = await readFile(filePath, 'utf8');
  } catch (error) {
    if (!isMissingFileError(error)) {
      logger().warn({err: error, path: filePath}, 'Repository skill could not be read');
    }
    return undefined;
  }
  let frontmatter: Record<string, unknown>;
  try {
    frontmatter = parseFrontmatter(content).frontmatter;
  } catch (error) {
    logger().warn({err: error, path: filePath}, 'Repository skill has invalid frontmatter');
    return undefined;
  }
  const description = typeof frontmatter.description === 'string' ? frontmatter.description : '';
  // Both harnesses list a skill by its description, so a skill without one is unusable.
  if (description.trim().length === 0) {
    logger().warn({path: filePath}, 'Repository skill has no description');
    return undefined;
  }
  const name =
    typeof frontmatter.name === 'string' && frontmatter.name.trim().length > 0
      ? frontmatter.name.trim()
      : directoryName;
  return {name, description, directory, filePath, displayPath: displayPath(root, directory)};
}

function selectSkills(
  skills: readonly RepositorySkill[],
  selection: true | readonly string[],
): RepositorySkill[] {
  if (selection === true) return [...skills];
  const byName = new Map(skills.map((skill) => [skill.name, skill]));
  const names = [...new Set(selection)];
  const missing = names.filter((name) => !byName.has(name));
  if (missing.length > 0) {
    const available =
      skills.length === 0
        ? 'The repository has no skills in .agents/skills or .claude/skills.'
        : `Available skills: ${skills.map((skill) => skill.name).join(', ')}.`;
    throw new AgentConfigError(
      `Repository skills not found: ${missing.join(', ')}. ${available}`,
      'step_config_invalid',
    );
  }
  return names.flatMap((name) => byName.get(name) ?? []);
}

function displayPath(root: string, path: string): string {
  return relative(root, path).split(sep).join('/');
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR' || error.code === 'EISDIR')
  );
}
