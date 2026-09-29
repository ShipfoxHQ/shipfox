import {parseWorkflowActionRef, type WorkflowDocument} from '@shipfox/workflow-document';
import {parseTemplateHeader} from '@shipfox/workflow-templates/header';
import type {RegistryActionRef, RegistryRef} from './entities/registry-ref.js';

/**
 * The registry versions a workflow file uses. Actions come from the parsed document. The template
 * comes from the raw text, because the parsed document drops comments.
 */
export function collectRegistryRefs(params: {
  content: string;
  document: WorkflowDocument;
}): RegistryRef[] {
  const refs: RegistryRef[] = collectActionRefs(params.document);
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

function collectActionRefs(document: WorkflowDocument): RegistryActionRef[] {
  const refs = new Map<string, RegistryActionRef>();
  for (const [jobKey, job] of Object.entries(document.jobs)) {
    for (const [index, step] of job.steps.entries()) {
      if (step.uses === undefined) continue;
      const parsed = parseWorkflowActionRef(step.uses);
      if (!(parsed.ok && parsed.ref.kind === 'registry')) continue;

      const {namespace, name, version} = parsed.ref;
      const id = `${namespace}/${name}@${version}`;
      const ref = refs.get(id) ?? {
        kind: 'action' as const,
        package: `${namespace}/${name}`,
        version,
        steps: [],
      };
      ref.steps.push(`${jobKey}.${step.key ?? index}`);
      refs.set(id, ref);
    }
  }
  return [...refs.values()];
}
