import type {WorkflowTemplateManifest} from './manifest.js';
import {validateModelAnchors} from './model-anchors.js';

export type PartBlocks = Readonly<Record<string, string>>;
export type TemplateRoleBindings = Readonly<Record<string, string>>;

const newlinePattern = /\n/;
const leadingWhitespacePattern = /^\s*/;
const partMarkerPattern = /^(\s*)#\s*part:([a-z0-9_-]+)\.([a-z0-9_-]+)\s*$/;

/** Composes a base workflow by replacing its part markers with indented blocks. */
export function composeWorkflow(workflow: string, parts: PartBlocks): string {
  const lines = workflow.split(newlinePattern);

  return lines
    .map((line) => {
      const marker = partMarkerPattern.exec(line);
      if (marker === null) return line;

      const indentation = marker[1];
      const role = marker[2];
      const name = marker[3];
      if (indentation === undefined || role === undefined || name === undefined) return line;

      const block = parts[`${role}.${name}`] ?? parts[name];
      if (block === undefined) {
        throw new Error(`Missing workflow template part: ${role}.${name}`);
      }

      return indentPart(dedent(block), indentation);
    })
    .join('\n');
}

/** Composes a template after selecting one provider part for each declared role. */
export function composeTemplate(
  template: {manifest: WorkflowTemplateManifest; workflow: string; parts: PartProviderBlocks},
  bindings: TemplateRoleBindings,
): string {
  const selectedParts: Record<string, string> = {};

  for (const [role, declaration] of Object.entries(template.manifest.roles)) {
    const provider = bindings[role];
    if (provider === undefined) {
      throw new Error(`Missing provider binding for workflow template role: ${role}`);
    }
    if (!declaration.providers.includes(provider)) {
      throw new Error(`Unsupported provider for ${role}: ${provider}`);
    }

    const blocks = template.parts[role]?.[provider];
    if (blocks === undefined) {
      throw new Error(`Missing part file for ${role}: ${provider}`);
    }

    for (const [name, block] of Object.entries(blocks)) {
      selectedParts[`${role}.${name}`] = block;
    }
  }

  const composed = composeWorkflow(template.workflow, selectedParts);
  validateModelAnchors(template.manifest, composed);
  return composed;
}

export type PartProviderBlocks = Readonly<Record<string, Readonly<Record<string, PartBlocks>>>>;

export const composeWorkflowTemplate = composeTemplate;

function dedent(block: string): string {
  const lines = block.replace(/\r\n/g, '\n').split('\n');
  while (lines[0] === '') lines.shift();
  while (lines.at(-1) === '') lines.pop();

  const indentation = Math.min(
    ...lines
      .filter((line) => line.trim() !== '')
      .map((line) => line.match(leadingWhitespacePattern)?.[0].length ?? 0),
  );
  return lines.map((line) => line.slice(indentation)).join('\n');
}

function indentPart(block: string, indentation: string): string {
  return block
    .split('\n')
    .map((line) => (line === '' ? line : `${indentation}${line}`))
    .join('\n');
}
