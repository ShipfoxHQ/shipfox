import {
  computeActionBump,
  deriveActionMetadata,
  diffActionCapabilities,
  type RegistryActionMetadata,
  type RegistryBump,
  type RegistryReference,
} from '@shipfox/registry-format';
import {
  type ActionBundleFile,
  type ActionManifest,
  actionManifestSchema,
} from '@shipfox/workflow-document';
import {
  computeTemplateBump,
  deriveTemplateMetadata,
  type WorkflowTemplateManifest,
  type WorkflowTemplateMetadata,
  workflowTemplateManifestSchema,
} from '@shipfox/workflow-templates';
import {readActionBundle} from '#publish/action-package.js';
import type {PublishDraft} from '#publish/draft.js';
import {collectTemplateActions, readTemplateBundle} from '#publish/template-package.js';
import type {PackageCard} from '#publish/versions.js';

type ActionDraft = Extract<PublishDraft, {kind: 'action'}>;
type TemplateDraft = Extract<PublishDraft, {kind: 'template'}>;

/** A package read from its content bundle: what differs between an action and a template. */
export type PreparedPackage =
  | {kind: 'action'; draft: ActionDraft; manifest: ActionManifest; actions: string[]}
  | {kind: 'template'; draft: TemplateDraft; manifest: WorkflowTemplateManifest; actions: string[]};

export function preparePackage({
  draft,
  name,
  files,
}: {
  draft: PublishDraft;
  name: string;
  files: readonly ActionBundleFile[];
}): PreparedPackage {
  if (draft.kind === 'action') {
    return {kind: 'action', draft, ...readActionBundle(files), actions: []};
  }
  const bundle = readTemplateBundle(files);
  const actions = collectTemplateActions({name, bundle, composition: draft.composition});
  return {kind: 'template', draft, manifest: bundle.manifest, actions};
}

/** The one-line description of an action, or the summary of a template. */
export function summaryOf(prepared: PreparedPackage): string | undefined {
  return prepared.kind === 'action' ? prepared.manifest.description : prepared.manifest.summary;
}

export function deriveMetadata({
  prepared,
  reference,
  contentBytes,
}: {
  prepared: PreparedPackage;
  reference: RegistryReference;
  contentBytes: number;
}): RegistryActionMetadata | WorkflowTemplateMetadata {
  return prepared.kind === 'action'
    ? deriveActionMetadata({reference, manifest: prepared.manifest, contentBytes})
    : deriveTemplateMetadata({manifest: prepared.manifest, contentBytes});
}

/** The fields of the package row that describe its latest version. */
export function packageCard({
  prepared,
  derived,
}: {
  prepared: PreparedPackage;
  derived: {integrations: string[]};
}): PackageCard {
  const {manifest} = prepared;
  return {
    title: prepared.kind === 'action' ? prepared.manifest.name : prepared.manifest.title,
    summary: summaryOf(prepared) ?? '',
    keywords: manifest.keywords ?? [],
    integrations: derived.integrations,
  };
}

/**
 * The smallest bump the changes need, from the manifest of the highest lower version, and whether
 * an action's reach into integrations changed.
 */
export function compareWithPrevious({
  prepared,
  previousManifest,
}: {
  prepared: PreparedPackage;
  previousManifest: unknown;
}): {required: RegistryBump; capabilityChange: boolean} {
  if (prepared.kind === 'action') {
    const previous = actionManifestSchema.parse(previousManifest);
    const change = {previous, next: prepared.manifest};
    return {
      required: computeActionBump(change),
      capabilityChange: diffActionCapabilities(change).length > 0,
    };
  }
  const previous = workflowTemplateManifestSchema.parse(previousManifest);
  return {
    required: computeTemplateBump({previous, next: prepared.manifest}),
    capabilityChange: false,
  };
}
