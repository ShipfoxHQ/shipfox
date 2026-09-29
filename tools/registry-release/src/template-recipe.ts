import {readdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {formatRegistryReference, type RegistryReference} from '@shipfox/registry-format';
import {
  type ActionBundleFile,
  InvalidWorkflowDocumentError,
  parseWorkflowActionRef,
  parseWorkflowDocument,
} from '@shipfox/workflow-document';
import {
  applyTemplateOptions,
  CURRENT_COMPOSITION,
  composeTemplate,
  type TemplateOptions,
  type TemplateRoleBindings,
  templateRoleBindings,
  type WorkflowTemplate,
  type WorkflowTemplateManifest,
  workflowTemplateManifestSchema,
} from '@shipfox/workflow-templates';
import {parse as parseYaml} from 'yaml';
import {z} from 'zod';

/** The template recipe number stamped into `builder.recipe`. */
export const TEMPLATE_RECIPE = 1;

const partBlocksSchema = z.record(z.string(), z.string());

export interface TemplateSource {
  manifest: WorkflowTemplateManifest;
  workflow: string;
  parts: WorkflowTemplate['parts'];
  /** The files of the `template-bundle@1`: `template.yaml`, `workflow.yml`, `GUIDE.md`, `parts/**`. */
  files: ActionBundleFile[];
}

export interface TemplateVariant {
  label: string;
  yaml: string;
}

export async function readTemplateSource(directory: string): Promise<TemplateSource> {
  const read = (name: string) => readFile(join(directory, name), 'utf8');
  const [manifestText, workflow, guide] = await Promise.all([
    read('template.yaml'),
    read('workflow.yml'),
    read('GUIDE.md'),
  ]);
  const manifest = workflowTemplateManifestSchema.parse(parseYaml(manifestText));
  const partFiles = await readPartFiles(directory);

  const parts: Record<string, Record<string, Record<string, string>>> = {};
  for (const {path, content} of partFiles) {
    const [, role, file] = path.split('/');
    if (role === undefined || file === undefined || !file.endsWith('.yml')) continue;
    const blocks = partBlocksSchema.safeParse(parseYaml(content));
    if (!blocks.success) {
      throw new Error(`${path} must be a YAML map of string blocks`);
    }
    parts[role] ??= {};
    parts[role][file.slice(0, -'.yml'.length)] = blocks.data;
  }

  return {
    manifest,
    workflow,
    parts,
    files: [
      {path: 'template.yaml', content: manifestText},
      {path: 'workflow.yml', content: workflow},
      {path: 'GUIDE.md', content: guide},
      ...partFiles,
    ],
  };
}

/**
 * Every composition a template can produce: each role binding with the default
 * choices, then the richest binding with no options and with each option
 * choice alone. It matches the golden corpus, so the checks and the corpus
 * exercise the same compositions.
 */
export function composeTemplateVariants({
  reference,
  source,
  composition = CURRENT_COMPOSITION,
}: {
  reference: RegistryReference;
  source: TemplateSource;
  composition?: number;
}): TemplateVariant[] {
  const {manifest} = source;
  // The registry header does not read `revision`; only the legacy header does.
  const template = {
    id: reference.name,
    revision: 0,
    manifest,
    workflow: source.workflow,
    parts: source.parts,
  };
  const compose = (bindings: TemplateRoleBindings, options: TemplateOptions) =>
    applyTemplateOptions(
      composeTemplate(template, bindings, {
        composition,
        options,
        header: {kind: 'registry', reference},
      }),
      options,
      {composition},
    );

  const defaults = Object.fromEntries(
    manifest.options.flatMap(({id: optionId, choices}) => {
      const choice = choices.find(({default: isDefault}) => isDefault === true);
      return choice === undefined ? [] : [[optionId, choice.id]];
    }),
  );
  const allBindings = templateRoleBindings(manifest.roles);
  const richest = allBindings.reduce((most, next) =>
    Object.keys(next).length > Object.keys(most).length ? next : most,
  );

  return [
    ...allBindings.map((bindings) => ({
      label: `${bindingLabel(bindings)} with default options`,
      yaml: compose(bindings, defaults),
    })),
    {label: `${bindingLabel(richest)} with no options`, yaml: compose(richest, {})},
    ...manifest.options.flatMap((option) =>
      option.choices.map((choice) => ({
        label: `${bindingLabel(richest)} with ${option.id}=${choice.id}`,
        yaml: compose(richest, {[option.id]: choice.id}),
      })),
    ),
  ];
}

/**
 * Parses every variant with the workspace workflow schema and returns the
 * registry actions the variants use, sorted and unique. A template can only
 * use exact registry references, never repository paths.
 */
export function collectRegistryActions(variants: readonly TemplateVariant[]): string[] {
  const references = new Set<string>();
  for (const variant of variants) {
    for (const uses of usesOf(variant)) references.add(registryReferenceOf({variant, uses}));
  }
  return [...references].sort();
}

function usesOf({label, yaml}: TemplateVariant): string[] {
  let document: ReturnType<typeof parseWorkflowDocument>;
  try {
    document = parseWorkflowDocument(parseYaml(yaml), {actions: true, registryActions: true});
  } catch (error) {
    throw new Error(`${label} does not parse as a workflow: ${describeError(error)}`, {
      cause: error,
    });
  }
  return Object.values(document.jobs)
    .flatMap((job) => job.steps)
    .flatMap((step) => (step.uses === undefined ? [] : [step.uses]));
}

function registryReferenceOf({variant, uses}: {variant: TemplateVariant; uses: string}): string {
  const result = parseWorkflowActionRef(uses);
  if (!result.ok) throw new Error(`${variant.label}: uses ${uses}: ${result.message}`);
  if (result.ref.kind === 'local') {
    throw new Error(
      `${variant.label}: uses ${uses}: a template can only use registry actions, such as shipfox/x@1.4.2`,
    );
  }
  return formatRegistryReference(result.ref);
}

async function readPartFiles(directory: string): Promise<ActionBundleFile[]> {
  const files: ActionBundleFile[] = [];
  const visit = async (relative: string) => {
    const entries = await readdir(join(directory, relative), {withFileTypes: true});
    for (const entry of entries) {
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile())
        files.push({path, content: await readFile(join(directory, path), 'utf8')});
    }
  };
  await visit('parts');
  return files;
}

function bindingLabel(bindings: TemplateRoleBindings): string {
  const pairs = Object.entries(bindings).map(([role, provider]) => `${role}=${provider}`);
  return pairs.length === 0 ? 'no roles' : pairs.join(' ');
}

function describeError(error: unknown): string {
  if (error instanceof InvalidWorkflowDocumentError) {
    return error.validationError.issues
      .map(({path, message}) => `${path.join('.') || 'document'}: ${message}`)
      .join('; ');
  }
  return error instanceof Error ? error.message : String(error);
}
