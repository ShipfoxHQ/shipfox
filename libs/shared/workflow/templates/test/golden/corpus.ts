import {readdirSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {parse as parseYaml} from 'yaml';
import {
  applyTemplateOptions,
  composeTemplate,
  type TemplateOptions,
  type TemplateRoleBindings,
  templateRoleBindings,
  type WorkflowTemplate,
  type WorkflowTemplateManifest,
  workflowTemplateManifestSchema,
} from '#index.js';

/** The template pieces `composeTemplate` needs. Shipped templates satisfy it too. */
export interface CorpusTemplate {
  id: string;
  revision: number;
  manifest: WorkflowTemplateManifest;
  workflow: string;
  parts: WorkflowTemplate['parts'];
}

const fixtureRoot = new URL('./fixture/', import.meta.url);
const partMarkerPattern = /^\s*#\s*part:[a-z0-9_-]+\.[a-z0-9_-]+\s*$/m;
const optionMarkerPattern = /^\s*#\s*option:[a-z0-9_-]+=[a-z0-9_,-]+\s+(begin|end)\s*$/;
const optionBeginPattern = /^\s*#\s*option:[a-z0-9_-]+=[a-z0-9_,-]+\s+begin\s*$/;
const bindCommentPattern = /^\s*# bind:/m;
const slotCommentPattern = /^\s*# slot:/m;
const optionCommentPattern = /^\s*# option:[a-z0-9_-]+\s*$/m;
const multiChoiceBlockPattern = /^\s*# option:[a-z0-9_-]+=[a-z0-9_-]+,[a-z0-9_,-]+ begin$/m;
const modelMarkerPattern = /\s# model:[a-z0-9_-]+$/m;
const optionEndPattern = /^\s*#\s*option:[a-z0-9_-]+=[a-z0-9_,-]+\s+end\s*$/;

/**
 * The composer behaviors the fixture must exercise. Each detector reads the composed output of
 * every binding, and the raw parts for constructs that only exist before composing.
 */
const constructs: Readonly<
  Record<string, (template: CorpusTemplate, composed: string[]) => boolean>
> = {
  'leading-comments': (_, composed) =>
    composed.some((yaml) => yaml.startsWith('# yaml-language-server:')),
  'part-marker': (template) => partMarkerPattern.test(template.workflow),
  'part-with-blank-line': (template) =>
    partBlocks(template).some((block) =>
      block
        .trim()
        .split('\n')
        .some((line) => line === ''),
    ),
  'role-with-several-providers': (template) =>
    Object.values(template.manifest.roles).some(({providers}) => providers.length > 1),
  'optional-role': (template) =>
    Object.values(template.manifest.roles).some(({optional}) => optional === true),
  'bind-comment': (_, composed) => composed.some((yaml) => bindCommentPattern.test(yaml)),
  'slot-comment': (_, composed) => composed.some((yaml) => slotCommentPattern.test(yaml)),
  'option-comment': (_, composed) => composed.some((yaml) => optionCommentPattern.test(yaml)),
  'option-block': (_, composed) =>
    composed.some((yaml) => yaml.split('\n').some((line) => optionMarkerPattern.test(line))),
  'option-block-with-several-choices': (_, composed) =>
    composed.some((yaml) => multiChoiceBlockPattern.test(yaml)),
  'option-block-nested': (_, composed) => composed.some(hasNestedOptionBlocks),
  'option-block-in-part': (template) =>
    partBlocks(template).some((block) =>
      block.split('\n').some((line) => optionBeginPattern.test(line)),
    ),
  'model-marker': (_, composed) => composed.some((yaml) => modelMarkerPattern.test(yaml)),
};

export const constructNames = Object.keys(constructs);

/** Names the composer behaviors a template uses, so the fixture can be checked against real templates. */
export function usedConstructs(template: CorpusTemplate): Set<string> {
  const composed = templateRoleBindings(template.manifest.roles).map((bindings) =>
    composeTemplate(template, bindings),
  );
  return new Set(
    Object.entries(constructs).flatMap(([name, isUsed]) =>
      isUsed(template, composed) ? [name] : [],
    ),
  );
}

export function loadFixtureTemplate(): CorpusTemplate {
  const read = (path: string) => readFileSync(new URL(path, fixtureRoot), 'utf8');
  const parts: Record<string, Record<string, Record<string, string>>> = {};
  for (const role of readdirSync(new URL('parts/', fixtureRoot))) {
    parts[role] = {};
    for (const file of readdirSync(new URL(`parts/${role}/`, fixtureRoot))) {
      parts[role][file.replace('.yml', '')] = parseYaml(read(`parts/${role}/${file}`));
    }
  }
  return {
    id: 'composer-fixture',
    revision: 1,
    manifest: workflowTemplateManifestSchema.parse(parseYaml(read('template.yaml'))),
    workflow: read('workflow.yml'),
    parts,
  };
}

/**
 * Composes every golden file of one composition format, keyed by file name. Every binding gets
 * its default choices with each header grammar. The richest binding also gets no options, and
 * each option choice alone.
 */
export function composeGoldenFiles(
  composition: number,
  template: CorpusTemplate = loadFixtureTemplate(),
): Map<string, string> {
  const files = new Map<string, string>();
  const reference = {namespace: 'shipfox', name: template.id, version: '1.0.0'};
  const compose = (
    bindings: TemplateRoleBindings,
    options: TemplateOptions,
    header: 'registry' | 'legacy',
  ) =>
    applyTemplateOptions(
      composeTemplate(template, bindings, {
        composition,
        options,
        header: header === 'legacy' ? {kind: 'legacy'} : {kind: 'registry', reference},
      }),
      options,
      {composition},
    );
  const defaults = Object.fromEntries(
    template.manifest.options.flatMap(({id, choices}) => {
      const choice = choices.find(({default: isDefault}) => isDefault === true);
      return choice === undefined ? [] : [[id, choice.id]];
    }),
  );
  const allBindings = templateRoleBindings(template.manifest.roles);
  const richest = allBindings.reduce((most, next) =>
    Object.keys(next).length > Object.keys(most).length ? next : most,
  );

  for (const bindings of allBindings) {
    const label = bindingLabel(bindings);
    files.set(`${label}.defaults.yaml`, compose(bindings, defaults, 'registry'));
    files.set(`${label}.defaults.legacy.yaml`, compose(bindings, defaults, 'legacy'));
  }
  const label = bindingLabel(richest);
  files.set(`${label}.no-options.yaml`, compose(richest, {}, 'registry'));
  for (const option of template.manifest.options) {
    for (const choice of option.choices) {
      files.set(
        `${label}.option-${option.id}-${choice.id}.yaml`,
        compose(richest, {[option.id]: choice.id}, 'registry'),
      );
    }
  }
  return files;
}

export function compositionDirectory(composition: number): URL {
  return new URL(`composition-${composition}/`, import.meta.url);
}

export function compositionPath(composition: number): string {
  return fileURLToPath(compositionDirectory(composition));
}

function bindingLabel(bindings: TemplateRoleBindings): string {
  return Object.entries(bindings)
    .map(([role, provider]) => `${role}-${provider}`)
    .join('+');
}

function partBlocks(template: CorpusTemplate): string[] {
  return Object.values(template.parts).flatMap((providers) =>
    Object.values(providers).flatMap((blocks) => Object.values(blocks)),
  );
}

function hasNestedOptionBlocks(yaml: string): boolean {
  let depth = 0;
  for (const line of yaml.split('\n')) {
    if (optionBeginPattern.test(line)) depth += 1;
    else if (optionEndPattern.test(line)) depth -= 1;
    if (depth > 1) return true;
  }
  return false;
}
