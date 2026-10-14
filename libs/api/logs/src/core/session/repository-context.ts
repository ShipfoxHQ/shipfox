import type {SessionViewRow} from '@shipfox/api-logs-dto';
import {lifecycleRow} from './rows.js';
import type {AgentSessionRecord} from './session-record.js';

/** The runner records what an agent step read from the repository before the harness starts. */
export const REPOSITORY_CONTEXT_SESSION_ENTRY_TYPE = 'shipfox_repository_context';

interface RepositoryContextEntry {
  readonly instructionsEnabled: boolean;
  readonly skillsEnabled: boolean;
  readonly instructions: readonly {readonly path: string; readonly truncated: boolean}[];
  readonly skills: readonly string[];
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

function skillsDetail(entry: RepositoryContextEntry): string {
  if (!entry.skillsEnabled) return 'off';
  if (entry.skills.length === 0) return 'none found';
  return entry.skills.join(', ');
}

function parseRepositoryContextEntry(data: string): RepositoryContextEntry | undefined {
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
      typeof skill.name === 'string' ? [skill.name] : [],
    ),
  };
}

function arrayField(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
