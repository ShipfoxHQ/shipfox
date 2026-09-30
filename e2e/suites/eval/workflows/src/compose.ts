import {join} from 'node:path';
import {shippedTemplateLoader, type TemplateLoader} from '@shipfox/workflow-templates';
import {createDirectoryTemplateLoader} from '@shipfox/workflow-templates/testing';
import type {TemplateCase} from './schema.js';

const STANDALONE_SLOT = /^(\s*)# slot:([A-Za-z0-9_-]+)\s*$/u;
const INLINE_SLOT = /^(.*\S)\s+# slot:([A-Za-z0-9_-]+)\s*$/u;
const SLOT_PLACEHOLDER = /replace-with-[A-Za-z0-9/-]+/u;
const SHIPFOX_RUNNER = /^(\s*runner:\s*)shipfox\s*$/gmu;

/** The shipped templates, or the catalog directory a fixture case names. */
export function templateLoaderFor({
  templateCase,
  caseDirectory,
}: {
  templateCase: TemplateCase;
  caseDirectory: string;
}): TemplateLoader {
  if (templateCase.catalog === undefined) return shippedTemplateLoader;
  return createDirectoryTemplateLoader(join(caseDirectory, templateCase.catalog));
}

/**
 * Fills one line. It returns the replacement lines and the slot it used, if any. A marker alone on
 * its line is replaced by the value at the marker's indentation. A marker after a command
 * replaces the `replace-with-*` placeholder in that line.
 */
function fillLine({line, slots}: {line: string; slots: Record<string, string>}): {
  lines: string[];
  used?: string;
} {
  const standalone = STANDALONE_SLOT.exec(line);
  const inline = standalone ? null : INLINE_SLOT.exec(line);
  const name = standalone?.[2] ?? inline?.[2] ?? '';
  const value = slots[name];
  if (value === undefined) return {lines: [line]};
  if (standalone) {
    const indent = standalone[1] ?? '';
    return {
      lines: value.split('\n').map((valueLine) => `${indent}${valueLine}`.trimEnd()),
      used: name,
    };
  }
  const command = inline?.[1] ?? '';
  if (!SLOT_PLACEHOLDER.test(command)) return {lines: [line]};
  return {lines: [command.replace(SLOT_PLACEHOLDER, () => value)], used: name};
}

/** Fills the `# slot:<name>` markers the way the coding agent does. */
export function fillSlots({yaml, slots}: {yaml: string; slots: Record<string, string>}): string {
  const used = new Set<string>();
  const lines = yaml.split('\n').flatMap((line) => {
    const filled = fillLine({line, slots});
    if (filled.used !== undefined) used.add(filled.used);
    return filled.lines;
  });

  const unused = Object.keys(slots).filter((name) => !used.has(name));
  if (unused.length > 0) {
    throw new Error(`The composed workflow has no marker for slot ${unused.join(', ')}.`);
  }
  const filled = lines.join('\n');
  const remaining = SLOT_PLACEHOLDER.exec(filled);
  if (remaining) throw new Error(`The case leaves the placeholder ${remaining[0]} unfilled.`);
  return filled;
}

/** Sends the workflow to the case's own runner instead of the shared `shipfox` label. */
export function setRunnerLabel({yaml, label}: {yaml: string; label: string}): string {
  let replaced = 0;
  const result = yaml.replace(SHIPFOX_RUNNER, (_match, prefix: string) => {
    replaced += 1;
    return `${prefix}${label}`;
  });
  if (replaced === 0) throw new Error('The composed workflow has no `runner: shipfox` to replace.');
  return result;
}

/** Composes the case's variant through the loader, with its slots filled and its runner label set. */
export async function composeCaseWorkflow({
  templateCase,
  loader,
  runnerLabel,
}: {
  templateCase: TemplateCase;
  loader: TemplateLoader;
  runnerLabel: string;
}): Promise<string> {
  const composed = await loader.compose({
    package: templateCase.template,
    bindings: templateCase.bindings,
    options: templateCase.options as Record<string, string>,
  });
  if (composed === undefined) {
    throw new Error(`The template loader does not serve ${templateCase.template}.`);
  }
  return setRunnerLabel({
    yaml: fillSlots({yaml: composed, slots: templateCase.slots}),
    label: runnerLabel,
  });
}
