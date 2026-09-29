import type {RegistryReference} from '@shipfox/registry-format';
import {assertSupportedComposition, CURRENT_COMPOSITION} from './composition.js';
import {formatTemplateHeader} from './header.js';
import type {WorkflowTemplateManifest} from './manifest.js';
import {validateModelAnchors} from './model-anchors.js';

export type PartBlocks = Readonly<Record<string, string>>;
export type TemplateRoleBindings = Readonly<Record<string, string>>;
/** The chosen choice id for each option id. */
export type TemplateOptions = Readonly<Record<string, string>>;

/**
 * Which grammar the composer writes. `legacy` is `<id>@<revision>` and has no place for options.
 * `registry` names the registry package the composed template came from.
 */
export type TemplateHeaderChoice =
  | {kind: 'legacy'}
  | {kind: 'registry'; reference: RegistryReference};

export interface ComposeTemplateInput {
  options?: TemplateOptions;
  header?: TemplateHeaderChoice;
  /** The composition format, one of `SUPPORTED_COMPOSITIONS`. Defaults to the current format. */
  composition?: number;
}

export interface ApplyTemplateOptionsInput {
  /** The composition format, one of `SUPPORTED_COMPOSITIONS`. Defaults to the current format. */
  composition?: number;
}

interface OptionMarker {
  option: string;
  choices: readonly string[];
  edge: string | undefined;
  text: string;
}

interface OpenOptionBlock {
  marker: string;
  chosen: boolean;
  keep: boolean;
}

const newlinePattern = /\n/;
const leadingWhitespacePattern = /^\s*/;
const partMarkerPattern = /^(\s*)#\s*part:([a-z0-9_-]+)\.([a-z0-9_-]+)\s*$/;
const optionBlockPattern =
  /^\s*#\s*option:([a-z0-9][a-z0-9_-]*)=([a-z0-9][a-z0-9_-]*(?:,[a-z0-9][a-z0-9_-]*)*)\s+(begin|end)\s*$/;
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
 * Keeps the `# option:X=Y begin` blocks whose choice is chosen in `options`, deletes the other
 * blocks of the same option, and removes every begin and end marker line. `X=Y,Z` keeps its block
 * when either choice is chosen. Other comments, such as `# slot:` and `# bind:`, stay. An option
 * with no entry in `options` keeps its blocks and markers, so an empty `options` changes nothing.
 */
export function applyTemplateOptions(
  yaml: string,
  options: TemplateOptions,
  {composition = CURRENT_COMPOSITION}: ApplyTemplateOptionsInput = {},
): string {
  assertSupportedComposition(composition);

  const open: OpenOptionBlock[] = [];
  const kept: string[] = [];
  const emit = (line: string) => {
    if (open.every((block) => block.keep)) kept.push(line);
  };

  for (const line of yaml.split(newlinePattern)) {
    const marker = parseOptionMarker(line);
    if (marker === undefined) {
      emit(line);
      continue;
    }

    if (marker.edge === 'begin') {
      const block = openOptionBlock(marker, options);
      if (!block.chosen) emit(line);
      open.push(block);
      continue;
    }

    const block = open.pop();
    if (block?.marker !== marker.text) {
      throw new Error(`Unbalanced option block: # option:${marker.text} end`);
    }
    if (!block.chosen) emit(line);
  }

  const unclosed = open.at(-1);
  if (unclosed !== undefined) {
    throw new Error(`Unclosed option block: # option:${unclosed.marker} begin`);
  }
  return kept.join('\n');
}

/**
 * Composes a template after selecting one provider part for each bound role. An unbound optional
 * role drops its part markers. The composer writes the `# shipfox-template:` header from the
 * bindings, so it records which optional roles were chosen.
 *
 * `options` are checked against the manifest and recorded in a registry header. They are not
 * applied to the YAML, so pass the result to `applyTemplateOptions` for that. A legacy header,
 * the default, cannot record options.
 */
export function composeTemplate(
  template: {
    id: string;
    revision: number;
    manifest: WorkflowTemplateManifest;
    workflow: string;
    parts: PartProviderBlocks;
  },
  bindings: TemplateRoleBindings,
  {
    options = {},
    header = {kind: 'legacy'},
    composition = CURRENT_COMPOSITION,
  }: ComposeTemplateInput = {},
): string {
  assertSupportedComposition(composition);
  validateOptions(template.id, template.manifest, options);

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
  validateModelAnchors(template.id, template.manifest, composed);
  return withTemplateHeader(composed, templateHeader({template, bindings, options, header}));
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

export interface TemplateVariant {
  bindings: TemplateRoleBindings;
  options: TemplateOptions;
}

/**
 * Lists the static compositions needed to exercise a template: every role binding with its
 * default choices, followed by each individual choice on the richest role binding.
 */
export function templateVariants(template: {
  manifest: Pick<WorkflowTemplateManifest, 'roles' | 'options'>;
}): TemplateVariant[] {
  const defaults = Object.fromEntries(
    template.manifest.options.flatMap(({id, choices}) => {
      const choice = choices.find(({default: isDefault}) => isDefault === true) ?? choices[0];
      return choice === undefined ? [] : [[id, choice.id]];
    }),
  );
  const bindings = templateRoleBindings(template.manifest.roles);
  const richest = bindings.reduce((most, next) =>
    Object.keys(next).length > Object.keys(most).length ? next : most,
  );

  return [
    ...bindings.map((binding) => ({bindings: binding, options: defaults})),
    ...template.manifest.options.flatMap((option) =>
      option.choices.map((choice) => ({
        bindings: richest,
        options: {...defaults, [option.id]: choice.id},
      })),
    ),
  ];
}

export type PartProviderBlocks = Readonly<Record<string, Readonly<Record<string, PartBlocks>>>>;

export const composeWorkflowTemplate = composeTemplate;

function parseOptionMarker(line: string): OptionMarker | undefined {
  const [, option, choices, edge] = optionBlockPattern.exec(line) ?? [];
  if (option === undefined || choices === undefined) return undefined;
  return {option, choices: choices.split(','), edge, text: `${option}=${choices}`};
}

function openOptionBlock(
  {option, choices, text}: OptionMarker,
  options: TemplateOptions,
): OpenOptionBlock {
  const choice = Object.hasOwn(options, option) ? options[option] : undefined;
  return {
    marker: text,
    chosen: choice !== undefined,
    keep: choice === undefined || choices.includes(choice),
  };
}

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

function validateOptions(
  templateId: string,
  manifest: Pick<WorkflowTemplateManifest, 'options'>,
  options: TemplateOptions,
): void {
  for (const [id, choice] of Object.entries(options)) {
    const declaration = manifest.options.find((option) => option.id === id);
    if (declaration === undefined) throw new Error(`${templateId}: unknown option ${id}`);
    if (!declaration.choices.some((candidate) => candidate.id === choice)) {
      throw new Error(`${templateId}: unsupported choice for option ${id}: ${choice}`);
    }
  }
}

function templateHeader({
  template,
  bindings,
  options,
  header,
}: {
  template: {id: string; revision: number; manifest: WorkflowTemplateManifest};
  bindings: TemplateRoleBindings;
  options: TemplateOptions;
  header: TemplateHeaderChoice;
}): string {
  const roles = manifestOrderedPairs(Object.keys(template.manifest.roles), bindings);
  if (header.kind === 'legacy') {
    return formatTemplateHeader({
      legacy: {id: template.id, revision: template.revision, bindings: roles},
    });
  }
  return formatTemplateHeader({
    ref: header.reference,
    bindings: roles,
    options: manifestOrderedPairs(
      template.manifest.options.map((option) => option.id),
      options,
    ),
  });
}

function manifestOrderedPairs(
  keys: readonly string[],
  values: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    keys.flatMap((key) => {
      const value = Object.hasOwn(values, key) ? values[key] : undefined;
      return value === undefined ? [] : [[key, value]];
    }),
  );
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
