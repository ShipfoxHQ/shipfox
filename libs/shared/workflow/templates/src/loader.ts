import {parse as parseYaml} from 'yaml';
import {composeTemplate, type PartProviderBlocks, type TemplateRoleBindings} from './composer.js';
import {embeddedWorkflowTemplateAssets} from './generated/assets.js';
import {type WorkflowTemplateManifest, workflowTemplateManifestSchema} from './manifest.js';
import {extractModelAnchors} from './model-anchors.js';

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
}

export interface TemplateLoader {
  list(): readonly WorkflowTemplate[];
  get(id: string): WorkflowTemplate | undefined;
  compose(id: string, bindings: TemplateRoleBindings): string | undefined;
}

/** Creates an injectable loader. Production uses only the generated asset module. */
export function createTemplateLoader(assets: readonly WorkflowTemplateAsset[]): TemplateLoader {
  const templates = assets.map(normalizeTemplate);
  for (const template of templates) validateTemplateModelAnchors(template);

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

function normalizeTemplate(asset: WorkflowTemplateAsset): WorkflowTemplate {
  const manifest =
    typeof asset.manifest === 'string'
      ? workflowTemplateManifestSchema.parse(parseYaml(asset.manifest))
      : workflowTemplateManifestSchema.parse(asset.manifest);

  return {
    manifest,
    workflow: asset.workflow,
    guide: asset.guide,
    parts: asset.parts,
  };
}

function validateTemplateModelAnchors(template: WorkflowTemplate): void {
  const declaredPlaceholders = new Set(Object.keys(template.manifest.models));

  for (const bindings of roleBindings(template.manifest.roles)) {
    const anchors = extractModelAnchors(composeTemplate(template, bindings));
    for (const placeholder of declaredPlaceholders) {
      if (!Object.hasOwn(anchors, placeholder)) {
        throw new Error(
          `Workflow template ${template.manifest.id} is missing a model marker for "${placeholder}"`,
        );
      }
    }
    for (const placeholder of Object.keys(anchors)) {
      if (!declaredPlaceholders.has(placeholder)) {
        throw new Error(
          `Workflow template ${template.manifest.id} has a model marker for undeclared placeholder "${placeholder}"`,
        );
      }
    }
  }
}

function roleBindings(roles: WorkflowTemplateManifest['roles']): TemplateRoleBindings[] {
  return Object.entries(roles).reduce<TemplateRoleBindings[]>(
    (bindings, [role, declaration]) =>
      bindings.flatMap((binding) =>
        declaration.providers.map((provider) => ({...binding, [role]: provider})),
      ),
    [{}],
  );
}
