import {
  type ActionManifest,
  type ActionManifestInputDeclaration,
  type ActionManifestIntegration,
  type ActionManifestOutputDeclaration,
  actionPathRelativePart,
  isCompositeActionManifest,
  parseWorkflowActionRef,
  WORKFLOW_ACTION_PATH_PREFIX,
  workflowDocumentStepOutputTypes,
} from '@shipfox/workflow-document';
import {z} from 'zod';
import type {RegistryBump} from '#documents.js';
import {formatRegistryReference, type RegistryReference} from '#reference.js';

export const REGISTRY_ACTION_KINDS = ['javascript', 'composite'] as const;

/** The most files a composite action bundle holds, as for a repository action. */
export const COMPOSITE_ACTION_MAX_FILES = 100;
/** The most bytes of file content a composite action bundle holds, as for a repository action. */
export const COMPOSITE_ACTION_MAX_BYTES = 1024 * 1024;

export const registryActionMetadataSchema = z.object({
  /** Absent on versions published before composite actions, which are JavaScript actions. */
  kind: z.enum(REGISTRY_ACTION_KINDS).optional(),
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
        /** Set on the inputs of a composite action that receive a secret. */
        secret: z.literal(true).optional(),
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
export type RegistryActionKind = (typeof REGISTRY_ACTION_KINDS)[number];

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
  const bumps: RegistryBump[] = [
    ...(actionKind(previous) === actionKind(next) ? [] : ['major' as const]),
    ...inputBumps(entries(previous.inputs), entries(next.inputs)),
    ...outputBumps(entries(previous.outputs), entries(next.outputs)),
    ...diffActionCapabilities({previous, next}).map(
      (change) => CAPABILITY_CHANGE_BUMP[change.type],
    ),
    ...postBumps(previous, next),
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
    kind: actionKind(manifest),
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
          ([name, {type, required, default: value, secret, description}]) => [
            name,
            {
              type,
              required,
              default: value,
              ...(secret ? {secret: true as const} : {}),
              description,
            },
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
    // A secret input takes only secret references, and other inputs take none, so the flag is
    // part of the type.
    if (!later || later.type !== input.type || isSecret(later) !== isSecret(input)) {
      bumps.push('major');
    } else if (mustBeProvided(later) && !mustBeProvided(input)) bumps.push('major');
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

function postBumps(previous: ActionManifest, next: ActionManifest): RegistryBump[] {
  const bumps: RegistryBump[] = [];
  if ((previous.post === undefined) !== (next.post === undefined)) bumps.push('minor');
  const before = previous.post === undefined ? undefined : (previous.post_failure ?? 'warn');
  const after = next.post === undefined ? undefined : (next.post_failure ?? 'warn');
  // A post that can now fail the job breaks workflows that passed with it. Adding a `fail` post is
  // the `minor` above.
  if (before === 'warn' && after === 'fail') bumps.push('major');
  if (before === 'fail' && after === 'warn') bumps.push('patch');
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

export function actionKind(manifest: ActionManifest): RegistryActionKind {
  return isCompositeActionManifest(manifest) ? 'composite' : 'javascript';
}

export type CompositeActionReferences =
  | {ok: true; actions: string[]}
  | {ok: false; uses: string; message: string};

/**
 * The exact registry actions the steps of a composite action use, sorted and unique, and none
 * for a JavaScript action. A registry composite can use registry actions only: a repository path
 * or a `${{ action.path }}/` path would not exist where the composite runs.
 */
export function collectCompositeActions(manifest: ActionManifest): CompositeActionReferences {
  if (!isCompositeActionManifest(manifest)) return {ok: true, actions: []};
  const references = new Set<string>();
  for (const {uses} of manifest.steps) {
    if (uses === undefined) continue;
    if (actionPathRelativePart(uses) !== undefined) {
      return {
        ok: false,
        uses,
        message: `A registry composite action cannot use \`${WORKFLOW_ACTION_PATH_PREFIX}\` in \`uses\`. Publish the inner action and use it by version.`,
      };
    }
    const ref = parseWorkflowActionRef(uses);
    if (!ref.ok) return {ok: false, uses, message: ref.message};
    if (ref.ref.kind === 'local') {
      return {
        ok: false,
        uses,
        message:
          'A registry composite action can use registry actions only, such as shipfox/x@1.4.2, not repository paths.',
      };
    }
    references.add(formatRegistryReference(ref.ref));
  }
  return {ok: true, actions: [...references].sort()};
}

function isSecret(input: ActionManifestInputDeclaration): boolean {
  return input.secret === true;
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
