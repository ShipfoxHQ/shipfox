import {
  type ActionManifest,
  type ActionManifestInputDeclaration,
  type ActionManifestIntegration,
  type ActionManifestOutputDeclaration,
  workflowDocumentStepOutputTypes,
} from '@shipfox/workflow-document';
import {z} from 'zod';
import type {RegistryBump} from '#documents.js';
import {formatRegistryReference, type RegistryReference} from '#reference.js';

export const registryActionMetadataSchema = z.object({
  /** Providers of the manifest's integration aliases, sorted and unique. */
  integrations: z.array(z.string()),
  capabilities: z.record(
    z.string(),
    z.object({provider: z.string(), selectors: z.array(z.string()), allow_write: z.boolean()}),
  ),
  interface: z.object({
    inputs: z.record(
      z.string(),
      z.object({
        type: z.enum(workflowDocumentStepOutputTypes),
        required: z.boolean(),
        default: z.unknown().optional(),
        description: z.string().optional(),
      }),
    ),
    outputs: z.record(
      z.string(),
      z.object({
        type: z.enum(workflowDocumentStepOutputTypes),
        required: z.boolean(),
        description: z.string().optional(),
      }),
    ),
  }),
  /** A YAML step snippet with `uses:`, the inputs a step must provide, and `connections:`. */
  usage: z.string(),
  /** Content bundle bytes. */
  size: z.number().int().nonnegative(),
});

export type RegistryActionMetadata = z.infer<typeof registryActionMetadataSchema>;

export type ActionCapabilityChange =
  | {type: 'alias_added'; alias: string; provider: string}
  | {type: 'alias_removed'; alias: string; provider: string}
  | {type: 'provider_changed'; alias: string; from: string; to: string}
  | {type: 'write_enabled'; alias: string}
  | {type: 'write_disabled'; alias: string}
  | {type: 'selectors_added'; alias: string; selectors: string[]}
  | {type: 'selectors_removed'; alias: string; selectors: string[]};

export interface ActionManifestChange {
  previous: ActionManifest;
  next: ActionManifest;
}

const BUMP_RANK: Record<RegistryBump, number> = {patch: 0, minor: 1, major: 2};

const CAPABILITY_CHANGE_BUMP: Record<ActionCapabilityChange['type'], RegistryBump> = {
  alias_added: 'major',
  alias_removed: 'major',
  provider_changed: 'major',
  write_enabled: 'major',
  write_disabled: 'patch',
  selectors_added: 'minor',
  selectors_removed: 'patch',
};

/** The minimum bump from `previous` to `next`, from their manifests alone. */
export function computeActionBump({previous, next}: ActionManifestChange): RegistryBump {
  const bumps = [
    ...inputBumps(entries(previous.inputs), entries(next.inputs)),
    ...outputBumps(entries(previous.outputs), entries(next.outputs)),
    ...diffActionCapabilities({previous, next}).map(
      (change) => CAPABILITY_CHANGE_BUMP[change.type],
    ),
  ];
  return bumps.reduce<RegistryBump>(
    (highest, bump) => (BUMP_RANK[bump] > BUMP_RANK[highest] ? bump : highest),
    'patch',
  );
}

/**
 * Changes to what the action can reach through its integration aliases. A
 * provider change reports only `provider_changed`, because selectors of
 * different providers do not compare.
 */
export function diffActionCapabilities({
  previous,
  next,
}: ActionManifestChange): ActionCapabilityChange[] {
  const before = entries(previous.integrations);
  const after = entries(next.integrations);
  const changes: ActionCapabilityChange[] = [];
  for (const [alias, integration] of before) {
    if (!after.has(alias)) {
      changes.push({type: 'alias_removed', alias, provider: integration.provider});
    }
  }
  for (const [alias, integration] of after) {
    const earlier = before.get(alias);
    if (earlier) changes.push(...integrationChanges(alias, earlier, integration));
    else changes.push({type: 'alias_added', alias, provider: integration.provider});
  }
  return changes;
}

export interface DeriveActionMetadataParams {
  reference: RegistryReference;
  manifest: ActionManifest;
  contentBytes: number;
}

export function deriveActionMetadata({
  reference,
  manifest,
  contentBytes,
}: DeriveActionMetadataParams): RegistryActionMetadata {
  const integrations = [...entries(manifest.integrations)];
  return {
    integrations: [...new Set(integrations.map(([, {provider}]) => provider))].sort(),
    capabilities: Object.fromEntries(
      integrations.map(([alias, {provider, include, allow_write}]) => [
        alias,
        {provider, selectors: include, allow_write},
      ]),
    ),
    interface: {
      inputs: Object.fromEntries(
        [...entries(manifest.inputs)].map(
          ([name, {type, required, default: value, description}]) => [
            name,
            {type, required, default: value, description},
          ],
        ),
      ),
      outputs: Object.fromEntries(
        [...entries(manifest.outputs)].map(([name, {type, required, description}]) => [
          name,
          {type, required, description},
        ]),
      ),
    },
    usage: actionUsage(reference, manifest),
    size: contentBytes,
  };
}

function inputBumps(
  before: Map<string, ActionManifestInputDeclaration>,
  after: Map<string, ActionManifestInputDeclaration>,
): RegistryBump[] {
  const bumps: RegistryBump[] = [];
  for (const [name, input] of before) {
    const later = after.get(name);
    if (!later || later.type !== input.type) bumps.push('major');
    else if (mustBeProvided(later) && !mustBeProvided(input)) bumps.push('major');
  }
  for (const [name, input] of after) {
    if (!before.has(name)) bumps.push(mustBeProvided(input) ? 'major' : 'minor');
  }
  return bumps;
}

function outputBumps(
  before: Map<string, ActionManifestOutputDeclaration>,
  after: Map<string, ActionManifestOutputDeclaration>,
): RegistryBump[] {
  const bumps: RegistryBump[] = [];
  for (const [name, output] of before) {
    if (after.get(name)?.type !== output.type) bumps.push('major');
  }
  for (const name of after.keys()) {
    if (!before.has(name)) bumps.push('minor');
  }
  return bumps;
}

function integrationChanges(
  alias: string,
  before: ActionManifestIntegration,
  after: ActionManifestIntegration,
): ActionCapabilityChange[] {
  if (before.provider !== after.provider) {
    return [{type: 'provider_changed', alias, from: before.provider, to: after.provider}];
  }
  const changes: ActionCapabilityChange[] = [];
  if (!before.allow_write && after.allow_write) changes.push({type: 'write_enabled', alias});
  if (before.allow_write && !after.allow_write) changes.push({type: 'write_disabled', alias});
  const added = after.include.filter((selector) => !before.include.includes(selector));
  if (added.length > 0) changes.push({type: 'selectors_added', alias, selectors: added});
  const removed = before.include.filter((selector) => !after.include.includes(selector));
  if (removed.length > 0) changes.push({type: 'selectors_removed', alias, selectors: removed});
  return changes;
}

function mustBeProvided(input: ActionManifestInputDeclaration): boolean {
  return input.required && input.default === undefined;
}

// Manifest keys are author-chosen, so a key such as `constructor` must not
// resolve through the object prototype.
function entries<Value>(record: Record<string, Value> | undefined): Map<string, Value> {
  return new Map(Object.entries(record ?? {}));
}

// Input names and aliases are identifiers, so they need no YAML quoting.
function actionUsage(reference: RegistryReference, manifest: ActionManifest): string {
  const lines = [`uses: ${formatRegistryReference(reference)}`];
  const inputs = [...entries(manifest.inputs)].filter(([, input]) => mustBeProvided(input));
  if (inputs.length > 0) {
    lines.push('with:', ...inputs.map(([name, {type}]) => `  ${name}: <${type}>`));
  }
  const integrations = [...entries(manifest.integrations)];
  if (integrations.length > 0) {
    lines.push(
      'connections:',
      ...integrations.map(([alias, {provider}]) => `  ${alias}: <${provider} connection>`),
    );
  }
  return `${lines.join('\n')}\n`;
}
