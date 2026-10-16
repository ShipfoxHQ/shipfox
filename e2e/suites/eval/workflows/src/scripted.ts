import {readFile} from 'node:fs/promises';
import {
  type ScriptedManagedProviderEntry,
  scriptedManagedProviderEntriesSchema,
} from '@shipfox/e2e-setup-agent';
import {rawJobSteps} from '@shipfox/workflow-document';
import {parse as parseYaml} from 'yaml';
import {CaseValidationError, formatValidationIssues} from './schema.js';

export function parseScriptedEntries(
  value: unknown,
  scriptPath = 'scripted.yaml',
): ScriptedManagedProviderEntry[] {
  const result = scriptedManagedProviderEntriesSchema.safeParse(value);
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

/** The keys of the steps that call a model, which a scripted case must have replies for. */
export function agentStepKeys(yaml: string): string[] {
  return [...rawJobSteps(parseYaml(yaml))].flatMap(({step}) =>
    step.prompt === undefined ? [] : [typeof step.key === 'string' ? step.key : '<unnamed step>'],
  );
}
