import type {WorkflowTemplateManifest} from './manifest.js';
import {validateModelAnchors} from './model-anchors.js';

export type PartBlocks = Readonly<Record<string, string>>;
export type TemplateRoleBindings = Readonly<Record<string, string>>;

const newlinePattern = /\n/;
const leadingWhitespacePattern = /^\s*/;
const partMarkerPattern = /^(\s*)#\s*part:([a-z0-9_-]+)\.([a-z0-9_-]+)\s*$/;
const templateHeaderPattern = /^#\s*shipfox-template:/;

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

/**
 * Composes a template after selecting one provider part for each bound role. An unbound optional
 * role drops its part markers. The composer writes the `# shipfox-template:` header from the
 * bindings, so it records which optional roles were chosen.
 */
export function composeTemplate(
  template: {manifest: WorkflowTemplateManifest; workflow: string; parts: PartProviderBlocks},
  bindings: TemplateRoleBindings,
): string {
  const selectedParts: Record<string, string> = {};
  const unboundRoles = new Set<string>();

  for (const [role, declaration] of Object.entries(template.manifest.roles)) {
    const provider = bindings[role];
    if (provider === undefined) {
      if (declaration.optional === true) {
        unboundRoles.add(role);
        continue;
      }
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

  const composed = composeWorkflow(
    withoutRoleParts(template.workflow, unboundRoles),
    selectedParts,
  );
  validateModelAnchors(template.manifest, composed);
  return withTemplateHeader(composed, templateHeader(template.manifest, bindings));
}

/** Lists every role binding a template supports, leaving each optional role both bound and unbound. */
export function templateRoleBindings(
  roles: WorkflowTemplateManifest['roles'],
): TemplateRoleBindings[] {
  return Object.entries(roles).reduce<TemplateRoleBindings[]>(
    (bindings, [role, declaration]) =>
      bindings.flatMap((binding) => [
        ...(declaration.optional === true ? [binding] : []),
        ...declaration.providers.map((provider) => ({...binding, [role]: provider})),
      ]),
    [{}],
  );
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

function withoutRoleParts(workflow: string, roles: ReadonlySet<string>): string {
  if (roles.size === 0) return workflow;
  return workflow
    .split(newlinePattern)
    .filter((line) => {
      const role = partMarkerPattern.exec(line)?.[2];
      return role === undefined || !roles.has(role);
    })
    .join('\n');
}

function templateHeader(
  manifest: WorkflowTemplateManifest,
  bindings: TemplateRoleBindings,
): string {
  const roles = Object.keys(manifest.roles)
    .filter((role) => bindings[role] !== undefined)
    .map((role) => `${role}=${bindings[role]}`);
  return `# shipfox-template: ${[`${manifest.id}@${manifest.revision}`, ...roles].join(' ')}`;
}

/** Places the header after the leading comments, such as a `yaml-language-server` modeline. */
function withTemplateHeader(workflow: string, header: string): string {
  const lines = workflow.split(newlinePattern);
  if (lines.some((line) => templateHeaderPattern.test(line))) {
    throw new Error(
      'The base workflow must not declare # shipfox-template; the composer writes it',
    );
  }
  const index = lines.findIndex((line) => !line.trimStart().startsWith('#'));
  lines.splice(index === -1 ? lines.length : index, 0, header);
  return lines.join('\n');
}
