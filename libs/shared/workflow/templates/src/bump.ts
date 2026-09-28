import type {WorkflowTemplateManifest, WorkflowTemplateRole} from './manifest.js';

export type TemplateBump = 'major' | 'minor' | 'patch';

export interface TemplateManifestChange {
  previous: WorkflowTemplateManifest;
  next: WorkflowTemplateManifest;
}

const BUMP_RANK: Record<TemplateBump, number> = {patch: 0, minor: 1, major: 2};

/**
 * The minimum bump from `previous` to `next`, from their manifests alone. The
 * workflow body and prompts are not compared, so a change to them is a patch.
 */
export function computeTemplateBump({previous, next}: TemplateManifestChange): TemplateBump {
  const bumps = [
    ...roleBumps({previous, next}),
    ...optionBumps({previous, next}),
    ...interfaceBumps({previous, next}),
    ...writeBumps({previous, next}),
  ];
  return bumps.reduce<TemplateBump>(
    (highest, bump) => (BUMP_RANK[bump] > BUMP_RANK[highest] ? bump : highest),
    'patch',
  );
}

function roleBumps({previous, next}: TemplateManifestChange): TemplateBump[] {
  const before = entries(previous.roles);
  const after = entries(next.roles);
  const bumps: TemplateBump[] = [];
  for (const [id, role] of before) {
    const later = after.get(id);
    bumps.push(...(later ? keptRoleBumps(role, later) : ['major' as const]));
  }
  for (const [id, role] of after) {
    if (!before.has(id)) bumps.push(isRequired(role) ? 'major' : 'minor');
  }
  return bumps;
}

function keptRoleBumps(before: WorkflowTemplateRole, after: WorkflowTemplateRole): TemplateBump[] {
  const bumps: TemplateBump[] = [];
  if (missingFrom(before.providers, after.providers).length > 0) bumps.push('major');
  if (missingFrom(after.providers, before.providers).length > 0) bumps.push('minor');
  // An adopter who left the role unbound cannot recompose without choosing a provider.
  if (isRequired(after) && !isRequired(before)) bumps.push('major');
  return bumps;
}

function optionBumps({previous, next}: TemplateManifestChange): TemplateBump[] {
  const before = new Map(previous.options.map((option) => [option.id, option]));
  const after = new Map(next.options.map((option) => [option.id, option]));
  const bumps: TemplateBump[] = [];
  for (const [id, option] of before) {
    const later = after.get(id);
    if (!later) {
      bumps.push('major');
      continue;
    }
    const choicesBefore = option.choices.map((choice) => choice.id);
    const choicesAfter = later.choices.map((choice) => choice.id);
    if (missingFrom(choicesBefore, choicesAfter).length > 0) bumps.push('major');
    if (missingFrom(choicesAfter, choicesBefore).length > 0) bumps.push('minor');
  }
  for (const id of after.keys()) {
    if (!before.has(id)) bumps.push('minor');
  }
  return bumps;
}

function interfaceBumps({previous, next}: TemplateManifestChange): TemplateBump[] {
  return missingFrom(interfaceKeys(next), interfaceKeys(previous)).length > 0 ? ['major'] : [];
}

function writeBumps({previous, next}: TemplateManifestChange): TemplateBump[] {
  return missingFrom(writeKeys(next), writeKeys(previous)).length > 0 ? ['minor'] : [];
}

function isRequired(role: WorkflowTemplateRole): boolean {
  return role.optional !== true;
}

// Slot ids, secret names, and variable names are separate namespaces, so the kind prefixes each key.
function interfaceKeys(manifest: WorkflowTemplateManifest): string[] {
  return [
    ...manifest.slots.map(({id}) => `slot:${id}`),
    ...manifest.secrets.map(({name}) => `secret:${name}`),
    ...manifest.variables.map(({name}) => `variable:${name}`),
  ];
}

// A write has no id, so its provider and text identify it. A reworded entry counts as a new one.
function writeKeys(manifest: WorkflowTemplateManifest): string[] {
  return manifest.writes.map(({provider, action}) => JSON.stringify([provider, action]));
}

function missingFrom(items: Iterable<string>, reference: Iterable<string>): string[] {
  const known = new Set(reference);
  return [...items].filter((item) => !known.has(item));
}

// Role ids are author-chosen, so a key such as `constructor` must not resolve
// through the object prototype.
function entries<Value>(record: Record<string, Value>): Map<string, Value> {
  return new Map(Object.entries(record));
}
