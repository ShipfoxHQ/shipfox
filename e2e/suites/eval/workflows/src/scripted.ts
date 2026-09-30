import {readFile} from 'node:fs/promises';
import type {ScriptedManagedProviderEntry} from '@shipfox/e2e-setup-agent';
import {parse as parseYaml} from 'yaml';
import {z} from 'zod';
import {CaseValidationError, formatValidationIssues} from './schema.js';

const replySchema = z.union([
  z.object({text: z.string()}).strict(),
  z.object({tool: z.string().min(1), args: z.record(z.string(), z.unknown()).optional()}).strict(),
]);

/**
 * The model replies of a scripted case. Each entry serves one step attempt: its first request
 * picks the first entry whose `prompt_contains` it contains, and later requests of that attempt
 * read the entry's next reply.
 */
export const scriptedEntriesSchema = z
  .array(
    z
      .object({
        match: z.object({prompt_contains: z.string().min(1)}).strict(),
        replies: z.array(replySchema).min(1),
      })
      .strict(),
  )
  .min(1);

export function parseScriptedEntries(
  value: unknown,
  scriptPath = 'scripted.yaml',
): ScriptedManagedProviderEntry[] {
  const result = scriptedEntriesSchema.safeParse(value);
  if (!result.success) {
    throw new CaseValidationError(scriptPath, formatValidationIssues(result.error));
  }
  return result.data;
}

/** Reads a case's `scripted.yaml`. A case without one gets `undefined`. */
export async function loadScriptedEntries(
  scriptPath: string,
): Promise<ScriptedManagedProviderEntry[] | undefined> {
  let source: string;
  try {
    source = await readFile(scriptPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  let document: unknown;
  try {
    document = parseYaml(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CaseValidationError(scriptPath, `could not parse YAML: ${message}`);
  }
  return parseScriptedEntries(document, scriptPath);
}
