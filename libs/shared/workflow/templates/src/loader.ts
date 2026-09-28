import {parseWorkflowDocument} from '@shipfox/workflow-document';
import {parse as parseYaml} from 'yaml';
import {
  composeTemplate,
  type PartProviderBlocks,
  type TemplateRoleBindings,
  templateRoleBindings,
} from './composer.js';
import {embeddedWorkflowTemplateAssets} from './generated/assets.js';
import {type WorkflowTemplateManifest, workflowTemplateManifestSchema} from './manifest.js';

export interface EmbeddedWorkflowTemplateAsset {
  manifest: string;
  workflow: string;
  guide: string;
  parts: PartProviderBlocks;
}

export interface WorkflowTemplateAsset {
  manifest: WorkflowTemplateManifest | string;
  workflow: string;
  guide: string;
  parts: PartProviderBlocks;
}

export interface WorkflowTemplate {
  manifest: WorkflowTemplateManifest;
  workflow: string;
  guide: string;
  parts: PartProviderBlocks;
  /** True when every role binding composes a workflow with a `source: manual` trigger. */
  startsManually: boolean;
}

export interface TemplateLoader {
  list(): readonly WorkflowTemplate[];
  get(id: string): WorkflowTemplate | undefined;
  compose(id: string, bindings: TemplateRoleBindings): string | undefined;
}

/** Creates an injectable loader. Production uses only the generated asset module. */
export function createTemplateLoader(assets: readonly WorkflowTemplateAsset[]): TemplateLoader {
  const templates = assets.map(loadTemplate);
  const byId = new Map(templates.map((template) => [template.manifest.id, template]));

  return {
    list: () => templates,
    get: (id) => byId.get(id),
    compose: (id, bindings) => {
      const template = byId.get(id);
      return template === undefined ? undefined : composeTemplate(template, bindings);
    },
  };
}

/** Returns the templates embedded into this package at build time. */
export function loadShippedTemplates(): readonly WorkflowTemplate[] {
  return shippedTemplateLoader.list();
}

export function listShippedTemplates(): readonly WorkflowTemplate[] {
  return shippedTemplateLoader.list();
}

export function getShippedTemplate(id: string): WorkflowTemplate | undefined {
  return shippedTemplateLoader.get(id);
}

export const shippedTemplateLoader = createTemplateLoader(embeddedWorkflowTemplateAssets);

function loadTemplate(asset: WorkflowTemplateAsset): WorkflowTemplate {
  const manifest =
    typeof asset.manifest === 'string'
      ? workflowTemplateManifestSchema.parse(parseYaml(asset.manifest))
      : workflowTemplateManifestSchema.parse(asset.manifest);
  const template = {manifest, workflow: asset.workflow, guide: asset.guide, parts: asset.parts};

  // Composing every binding also validates each one, so an optional role cannot hide a broken part.
  const startsManually = templateRoleBindings(manifest.roles)
    .map((bindings) => hasManualTrigger(composeTemplate(template, bindings)))
    .every(Boolean);
  if (!startsManually && manifest.start_label === undefined) {
    throw new Error(`${manifest.id}: a template without a manual trigger needs a start_label`);
  }

  return {...template, startsManually};
}

function hasManualTrigger(composed: string): boolean {
  const {triggers = {}} = parseWorkflowDocument(parseYaml(composed));
  return Object.values(triggers).some((trigger) => trigger.source === 'manual');
}
