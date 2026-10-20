import {
  isCompositeActionManifest,
  jobSteps,
  parseWorkflowActionRef,
  type WorkflowDocument,
} from '@shipfox/workflow-document';
import {parseTemplateHeader} from '@shipfox/workflow-templates/header';
import {collectReachableActions} from './collect-action-references.js';
import type {ResolvedActions} from './entities/action-snapshot.js';
import type {RegistryActionRef, RegistryRef} from './entities/registry-ref.js';

/**
 * The registry versions a workflow file uses. Actions come from the parsed document and from the
 * repository composite actions it reaches, which the workspace owns too. The pins inside a registry
 * composite action belong to its publisher, so they are left out. The template comes from the raw
 * text, because the parsed document drops comments.
 */
export function collectRegistryRefs(params: {
  content: string;
  document: WorkflowDocument;
  actions?: ResolvedActions | undefined;
}): RegistryRef[] {
  const refs: RegistryRef[] = collectActionRefs(params.document, params.actions);
  const header = parseTemplateHeader(params.content);
  if (header === undefined) return refs;

  if ('legacy' in header) {
    refs.push({
      kind: 'template',
      legacy: true,
      id: header.legacy.id,
      revision: header.legacy.revision,
    });
    return refs;
  }
  refs.push({
    kind: 'template',
    package: `${header.ref.namespace}/${header.ref.name}`,
    version: header.ref.version,
    bindings: {...header.bindings},
    options: {...header.options},
  });
  return refs;
}

function collectActionRefs(
  document: WorkflowDocument,
  actions: ResolvedActions | undefined,
): RegistryActionRef[] {
  const refs = new Map<string, RegistryActionRef>();
  for (const [jobKey, job] of Object.entries(document.jobs)) {
    for (const {step, index, member} of jobSteps(job)) {
      if (step.uses === undefined) continue;
      const location = `${jobKey}.${step.key ?? (member === undefined ? index : `${index}.${member}`)}`;
      addActionRef(refs, step.uses, location);
    }
  }
  for (const {uses, manifestPath} of repositoryCompositeUses(document, actions)) {
    addActionRef(refs, uses, manifestPath);
  }
  return [...refs.values()];
}

/** The `uses` of the steps of each repository composite action the document reaches. */
function repositoryCompositeUses(
  document: WorkflowDocument,
  actions: ResolvedActions | undefined,
): {uses: string; manifestPath: string}[] {
  if (actions === undefined) return [];
  return collectReachableActions(document, actions).flatMap((key) => {
    const action = actions.get(key);
    if (action?.composite === undefined || action.registry !== undefined) return [];
    if (!isCompositeActionManifest(action.manifest)) return [];
    const {manifestPath} = action.composite;
    return action.manifest.steps.flatMap(({uses}) =>
      uses === undefined ? [] : [{uses, manifestPath}],
    );
  });
}

function addActionRef(refs: Map<string, RegistryActionRef>, uses: string, location: string): void {
  const parsed = parseWorkflowActionRef(uses);
  if (!(parsed.ok && parsed.ref.kind === 'registry')) return;

  const {namespace, name, version} = parsed.ref;
  const id = `${namespace}/${name}@${version}`;
  const ref = refs.get(id) ?? {
    kind: 'action' as const,
    package: `${namespace}/${name}`,
    version,
    steps: [],
  };
  if (!ref.steps.includes(location)) ref.steps.push(location);
  refs.set(id, ref);
}
