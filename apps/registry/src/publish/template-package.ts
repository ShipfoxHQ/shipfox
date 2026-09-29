import {formatRegistryReference} from '@shipfox/registry-format';
import {type ActionBundleFile, parseWorkflowActionRef} from '@shipfox/workflow-document';
import {
  composeTemplate,
  templateRoleBindings,
  UnsupportedCompositionError,
  type WorkflowTemplateManifest,
  workflowTemplateManifestSchema,
} from '@shipfox/workflow-templates';
import {parse as parseYaml} from 'yaml';
import {VersionRefusedError} from '#publish/errors.js';
import {describeIssues} from '#publish/issues.js';

const MANIFEST_PATH = 'template.yaml';
const WORKFLOW_PATH = 'workflow.yml';
const GUIDE_PATH = 'GUIDE.md';
const PART_PATH = /^parts\/([^/]+)\/([^/]+)\.yml$/;

export interface TemplateBundle {
  manifest: WorkflowTemplateManifest;
  workflow: string;
  /** Blocks by role, then provider, then block name. */
  parts: Record<string, Record<string, Record<string, string>>>;
}

/** Reads a `template-bundle@1`: `template.yaml`, `workflow.yml`, `GUIDE.md`, and `parts/**`. */
export function readTemplateBundle(files: readonly ActionBundleFile[]): TemplateBundle {
  const byPath = new Map(files.map(({path, content}) => [path, content]));
  const manifestText = byPath.get(MANIFEST_PATH);
  const workflow = byPath.get(WORKFLOW_PATH);
  if (manifestText === undefined || workflow === undefined || !byPath.has(GUIDE_PATH)) {
    throw new VersionRefusedError(
      'invalid-bundle',
      `A template bundle needs ${MANIFEST_PATH}, ${WORKFLOW_PATH}, and ${GUIDE_PATH}`,
    );
  }

  const parts: TemplateBundle['parts'] = {};
  for (const {path, content} of files) {
    if (path === MANIFEST_PATH || path === WORKFLOW_PATH || path === GUIDE_PATH) continue;
    const [, role, provider] = PART_PATH.exec(path) ?? [];
    if (role === undefined || provider === undefined) {
      throw new VersionRefusedError(
        'invalid-bundle',
        `A template bundle holds parts/<role>/<provider>.yml files, not ${JSON.stringify(path)}`,
      );
    }
    parts[role] = {...parts[role], [provider]: readPart({path, content})};
  }

  const manifest = workflowTemplateManifestSchema.safeParse(
    parseYamlFile({path: MANIFEST_PATH, content: manifestText, reason: 'invalid-manifest'}),
  );
  if (!manifest.success) {
    throw new VersionRefusedError(
      'invalid-manifest',
      `${MANIFEST_PATH} is invalid: ${describeIssues(manifest.error)}`,
    );
  }
  return {manifest: manifest.data, workflow, parts};
}

/**
 * The exact registry actions the template can use, sorted. It composes every role binding with
 * every option block kept, so a choice a user makes later never adds an action this list misses.
 */
export function collectTemplateActions({
  name,
  bundle,
  composition,
}: {
  name: string;
  bundle: TemplateBundle;
  composition: number;
}): string[] {
  const references = new Set<string>();
  for (const bindings of templateRoleBindings(bundle.manifest.roles)) {
    let composed: string;
    try {
      composed = composeTemplate({id: name, revision: 1, ...bundle}, bindings, {composition});
    } catch (error) {
      if (error instanceof UnsupportedCompositionError) {
        throw new VersionRefusedError('unsupported-composition', error.message, {cause: error});
      }
      throw new VersionRefusedError(
        'invalid-template',
        `The template does not compose: ${error instanceof Error ? error.message : String(error)}`,
        {cause: error},
      );
    }
    for (const uses of usesOf(
      parseYamlFile({path: WORKFLOW_PATH, content: composed, reason: 'invalid-template'}),
    )) {
      const ref = parseWorkflowActionRef(uses);
      if (ref.ok && ref.ref.kind === 'registry') references.add(formatRegistryReference(ref.ref));
    }
  }
  return [...references].sort();
}

function readPart({path, content}: ActionBundleFile): Record<string, string> {
  const blocks = parseYamlFile({path, content, reason: 'invalid-bundle'});
  const isBlockMap =
    typeof blocks === 'object' &&
    blocks !== null &&
    !Array.isArray(blocks) &&
    Object.values(blocks).every((block) => typeof block === 'string');
  if (!isBlockMap) {
    throw new VersionRefusedError('invalid-bundle', `${path} must be a YAML map of string blocks`);
  }
  return blocks as Record<string, string>;
}

function parseYamlFile({
  path,
  content,
  reason,
}: {
  path: string;
  content: string;
  reason: 'invalid-manifest' | 'invalid-bundle' | 'invalid-template';
}): unknown {
  try {
    return parseYaml(content);
  } catch (error) {
    throw new VersionRefusedError(reason, `${path} is not valid YAML`, {cause: error});
  }
}

function usesOf(workflow: unknown): string[] {
  const jobs = (workflow as {jobs?: unknown} | null)?.jobs;
  if (typeof jobs !== 'object' || jobs === null) return [];
  return Object.values(jobs).flatMap((job) => {
    const steps = (job as {steps?: unknown} | null)?.steps;
    if (!Array.isArray(steps)) return [];
    return steps.flatMap((step) => {
      const uses = (step as {uses?: unknown} | null)?.uses;
      return typeof uses === 'string' ? [uses] : [];
    });
  });
}
