import {compareRegistryVersions, isRegistryVersion} from '@shipfox/registry-format';
import {parseWorkflowDocument} from '@shipfox/workflow-document';
import {parse as parseYaml} from 'yaml';
import {
  applyTemplateOptions,
  composeTemplate,
  type PartProviderBlocks,
  type TemplateOptions,
  type TemplateRoleBindings,
  templateRoleBindings,
} from './composer.js';
import {embeddedWorkflowTemplateAssets} from './generated/assets.js';
import {type WorkflowTemplateManifest, workflowTemplateManifestSchema} from './manifest.js';

/** The registry namespace of first-party templates, which a bare template id belongs to. */
export const FIRST_PARTY_TEMPLATE_NAMESPACE = 'shipfox';

export interface EmbeddedWorkflowTemplateAsset {
  id: string;
  version: string;
  revision: number;
  added_at: string;
  rank: number;
  manifest: string;
  workflow: string;
  guide: string;
  parts: PartProviderBlocks;
}

export interface WorkflowTemplateAsset {
  id: string;
  /** The exact semantic version of this copy of the template. */
  version: string;
  revision: number;
  added_at: string;
  rank: number;
  manifest: WorkflowTemplateManifest | string;
  workflow: string;
  guide: string;
  parts: PartProviderBlocks;
}

export interface WorkflowTemplate {
  id: string;
  /** The registry package name, `shipfox/<id>` for first-party templates. */
  package: string;
  version: string;
  revision: number;
  added_at: string;
  rank: number;
  manifest: WorkflowTemplateManifest;
  workflow: string;
  guide: string;
  parts: PartProviderBlocks;
  /** True when every role binding composes a workflow with a `source: manual` trigger. */
  startsManually: boolean;
}

export interface TemplateLoader {
  /** The latest servable version of each template. */
  list(): Promise<readonly WorkflowTemplate[]>;
  /** One version of a template, or the latest servable version when `version` is omitted. */
  get(params: {package: string; version?: string}): Promise<WorkflowTemplate | undefined>;
  /** Every servable version of a template, newest first. */
  versions(params: {package: string}): Promise<readonly string[]>;
  /**
   * Composes a version of a template, or its latest servable version when `version` is omitted.
   * `options` are applied to the YAML. The loader chooses the header form.
   */
  compose(params: {
    package: string;
    version?: string;
    bindings: TemplateRoleBindings;
    options?: TemplateOptions;
  }): Promise<string | undefined>;
}

/**
 * Names the package a tool input or prompt refers to. A bare id such as `ticket-to-pr` is the
 * first-party package `shipfox/ticket-to-pr`.
 */
export function resolveTemplatePackage(name: string): string {
  return name.includes('/') ? name : `${FIRST_PARTY_TEMPLATE_NAMESPACE}/${name}`;
}

/**
 * Creates an injectable loader. Production uses only the generated asset module. Assets that share
 * an id are versions of one template, and the highest version is the latest.
 */
export function createTemplateLoader(assets: readonly WorkflowTemplateAsset[]): TemplateLoader {
  return loaderOf(assets.map(loadTemplate));
}

function composeOptions({
  template,
  bindings,
  options,
}: {
  template: WorkflowTemplate | undefined;
  bindings: TemplateRoleBindings;
  options: TemplateOptions | undefined;
}): string | undefined {
  if (template === undefined) return undefined;
  const composed = composeTemplate(template, bindings, options === undefined ? {} : {options});
  return options === undefined ? composed : applyTemplateOptions(composed, options);
}

function loaderOf(templates: readonly WorkflowTemplate[]): TemplateLoader {
  const byPackage = new Map<string, WorkflowTemplate[]>();
  for (const template of templates) {
    const versions = byPackage.get(template.package) ?? [];
    if (versions.some(({version}) => version === template.version)) {
      throw new Error(`Duplicate template version: ${template.package}@${template.version}`);
    }
    versions.push(template);
    byPackage.set(template.package, versions);
  }
  for (const versions of byPackage.values()) {
    versions.sort((left, right) => compareRegistryVersions(right.version, left.version));
  }

  const find = ({package: name, version}: {package: string; version?: string | undefined}) => {
    const versions = byPackage.get(resolveTemplatePackage(name));
    return version === undefined
      ? versions?.[0]
      : versions?.find((item) => item.version === version);
  };

  return {
    list: async () => [...byPackage.values()].flatMap(([latest]) => (latest ? [latest] : [])),
    get: async (params) => find(params),
    versions: async ({package: name}) =>
      (byPackage.get(resolveTemplatePackage(name)) ?? []).map(({version}) => version),
    compose: async ({bindings, options, ...params}) =>
      composeOptions({template: find(params), bindings, options}),
  };
}

const shippedTemplates = embeddedWorkflowTemplateAssets.map(loadTemplate);

/** Returns the templates embedded into this package at build time. */
export function loadShippedTemplates(): readonly WorkflowTemplate[] {
  return shippedTemplates;
}

export const shippedTemplateLoader = loaderOf(shippedTemplates);

function loadTemplate(asset: WorkflowTemplateAsset): WorkflowTemplate {
  const manifest =
    typeof asset.manifest === 'string'
      ? workflowTemplateManifestSchema.parse(parseYaml(asset.manifest))
      : workflowTemplateManifestSchema.parse(asset.manifest);
  if (!isRegistryVersion(asset.version)) {
    throw new Error(`Template ${asset.id} has an invalid version: ${asset.version}`);
  }
  const template = {
    id: asset.id,
    package: `${FIRST_PARTY_TEMPLATE_NAMESPACE}/${asset.id}`,
    version: asset.version,
    revision: asset.revision,
    added_at: asset.added_at,
    rank: asset.rank,
    manifest,
    workflow: asset.workflow,
    guide: asset.guide,
    parts: asset.parts,
  };

  // Composing every binding also validates each one, so an optional role cannot hide a broken part.
  const startsManually = templateRoleBindings(manifest.roles)
    .map((bindings) => hasManualTrigger(composeTemplate(template, bindings)))
    .every(Boolean);
  return {...template, startsManually};
}

function hasManualTrigger(composed: string): boolean {
  const {triggers = {}} = parseWorkflowDocument(parseYaml(composed));
  return Object.values(triggers).some((trigger) => trigger.source === 'manual');
}
