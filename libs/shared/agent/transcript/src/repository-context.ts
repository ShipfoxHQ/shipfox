import type {SessionViewRow} from '@shipfox/api-logs-dto';
import {lifecycleRow} from './rows.js';
import type {AgentSessionRecord} from './session-record.js';

/** The runner records what an agent step read from the repository before the harness starts. */
export const REPOSITORY_CONTEXT_SESSION_ENTRY_TYPE = 'shipfox_repository_context';

interface RepositoryContextEntry {
  readonly instructionsEnabled: boolean;
  readonly skillsEnabled: boolean;
  readonly instructions: readonly {readonly path: string; readonly truncated: boolean}[];
  readonly skills: readonly {readonly name: string; readonly path: string | undefined}[];
}

/** Rows for a repository context entry, or `undefined` when the record is another entry. */
export function repositoryContextRows(
  record: AgentSessionRecord,
): readonly SessionViewRow[] | undefined {
  const entry = parseRepositoryContextEntry(record.data);
  if (entry === undefined) return undefined;
  return [
    lifecycleRow(
      record.ts,
      'Repository context',
      `Instructions: ${instructionsDetail(entry)}. Skills: ${skillsDetail(entry)}.`,
      'default',
      false,
    ),
  ];
}

function instructionsDetail(entry: RepositoryContextEntry): string {
  if (!entry.instructionsEnabled) return 'off';
  if (entry.instructions.length === 0) return 'none found';
  return entry.instructions
    .map((file) => (file.truncated ? `${file.path} (truncated)` : file.path))
    .join(', ');
}

// Skills are grouped by the directory they came from, so a missing skill can be traced to the
// checkout that should have held it.
function skillsDetail(entry: RepositoryContextEntry): string {
  if (!entry.skillsEnabled) return 'off';
  if (entry.skills.length === 0) return 'none found';
  const groups = new Map<string | undefined, string[]>();
  for (const skill of entry.skills) {
    const source = skill.path === undefined ? undefined : skillSource(skill.path);
    groups.set(source, [...(groups.get(source) ?? []), skill.name]);
  }
  return [...groups]
    .map(([source, names]) =>
      source === undefined ? names.join(', ') : `${names.join(', ')} (${source})`,
    )
    .join('; ');
}

function skillSource(path: string): string | undefined {
  const separator = path.lastIndexOf('/');
  return separator === -1 ? undefined : path.slice(0, separator);
}

// The runner serializes the entry with `type` first, so other entries skip the second parse.
const REPOSITORY_CONTEXT_ENTRY_PREFIX = `{"type":"${REPOSITORY_CONTEXT_SESSION_ENTRY_TYPE}"`;

function parseRepositoryContextEntry(data: string): RepositoryContextEntry | undefined {
  if (!data.startsWith(REPOSITORY_CONTEXT_ENTRY_PREFIX)) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return undefined;
  }
  if (!isRecord(value) || value.type !== REPOSITORY_CONTEXT_SESSION_ENTRY_TYPE) return undefined;
  return {
    instructionsEnabled: value.instructionsEnabled === true,
    skillsEnabled: value.skillsEnabled === true,
    instructions: arrayField(value.instructions).flatMap((file) =>
      typeof file.path === 'string' ? [{path: file.path, truncated: file.truncated === true}] : [],
    ),
    skills: arrayField(value.skills).flatMap((skill) =>
      typeof skill.name === 'string'
        ? [{name: skill.name, path: typeof skill.path === 'string' ? skill.path : undefined}]
        : [],
    ),
  };
}

function arrayField(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
