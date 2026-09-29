import {
  registryBumpSchema,
  registryPackageKindSchema,
  registryPackageNameSchema,
  registryVersionSchema,
} from '@shipfox/registry-format';
import {z} from 'zod';
import type {AgentAccessObjectSchema} from './envelope.js';
import {AGENT_ACCESS_DEFAULT_PAGE_LIMIT} from './paged-tools.js';

export const AGENT_ACCESS_REGISTRY_PAGE_SIZE = AGENT_ACCESS_DEFAULT_PAGE_LIMIT;
export const AGENT_ACCESS_REGISTRY_README_MAX_BYTES = 32 * 1024;
export const AGENT_ACCESS_REGISTRY_VERSIONS_MAX = 50;
export const AGENT_ACCESS_REGISTRY_DIFF_PAGE_MAX_BYTES = 64 * 1024;
export const AGENT_ACCESS_REGISTRY_CHANGELOG_ENTRY_MAX_BYTES = 4 * 1024;
export const AGENT_ACCESS_REGISTRY_CHANGELOG_MAX_BYTES = 32 * 1024;

const cursorSchema = z.string().min(1).max(256);
const packageSchema = registryPackageNameSchema.meta({
  description: 'A package name, such as `shipfox/slack-thread-digest`.',
});
const versionSchema = (description: string) => registryVersionSchema.meta({description});
const timestampSchema = z.string();
const jsonObjectSchema = z.record(z.string(), z.unknown());

export const listRegistryPackagesInputSchema = z.strictObject({
  kind: registryPackageKindSchema.optional().meta({description: 'Only `action` or `template`.'}),
  cursor: cursorSchema.optional(),
});
export type ListRegistryPackagesInputDto = z.output<typeof listRegistryPackagesInputSchema>;

export const getRegistryPackageInputSchema = z.strictObject({
  package: packageSchema,
  version: versionSchema('Defaults to the latest version.').optional(),
});
export type GetRegistryPackageInputDto = z.output<typeof getRegistryPackageInputSchema>;

export const diffRegistryActionInputSchema = z.strictObject({
  package: packageSchema,
  from: versionSchema('The version the workflow uses today.'),
  to: versionSchema('The version to move to. It must be higher than `from`.'),
  cursor: cursorSchema
    .optional()
    .meta({description: 'Pass `next_cursor` to read the next page of `source_diff`.'}),
});
export type DiffRegistryActionInputDto = z.output<typeof diffRegistryActionInputSchema>;

const catalogEntrySchema = z.strictObject({
  package: registryPackageNameSchema,
  kind: registryPackageKindSchema,
  title: z.string(),
  summary: z.string(),
  keywords: z.array(z.string()),
  integrations: z.array(z.string()),
  latest: registryVersionSchema,
  published_at: timestampSchema,
  first_published_at: timestampSchema,
  featured: z.number().int().positive().optional(),
  publisher: z.strictObject({
    namespace: z.string(),
    display_name: z.string(),
    verified: z.boolean(),
  }),
});

export const listRegistryPackagesResultSchema = z.strictObject({
  packages: z.array(catalogEntrySchema).max(AGENT_ACCESS_REGISTRY_PAGE_SIZE),
  next_cursor: cursorSchema.nullable(),
});
export type ListRegistryPackagesResultDto = z.output<typeof listRegistryPackagesResultSchema>;

const versionEntrySchema = z.strictObject({
  version: registryVersionSchema,
  digest: z.string(),
  published_at: timestampSchema,
  bump: registryBumpSchema.optional(),
  capability_change: z.boolean(),
});

export const getRegistryPackageResultSchema = z.strictObject({
  package: registryPackageNameSchema,
  kind: registryPackageKindSchema,
  version: registryVersionSchema,
  latest_version: registryVersionSchema,
  published_at: timestampSchema,
  license: z.string(),
  bump: registryBumpSchema.optional(),
  manifest: jsonObjectSchema,
  derived: jsonObjectSchema,
  dependencies: z.array(z.strictObject({name: z.string(), version: z.string()})).optional(),
  actions: z.array(z.string()),
  changelog: z.string().optional(),
  provenance: jsonObjectSchema,
  digests: z.strictObject({
    fingerprint: z.string(),
    content: z.string(),
    source: z.string(),
    readme: z.string().optional(),
  }),
  readme: z.string().nullable(),
  readme_truncated: z.boolean(),
  versions: z.array(versionEntrySchema).max(AGENT_ACCESS_REGISTRY_VERSIONS_MAX),
});
export type GetRegistryPackageResultDto = z.output<typeof getRegistryPackageResultSchema>;

const capabilityChangeSchema = z.discriminatedUnion('type', [
  z.strictObject({type: z.literal('alias_added'), alias: z.string(), provider: z.string()}),
  z.strictObject({type: z.literal('alias_removed'), alias: z.string(), provider: z.string()}),
  z.strictObject({
    type: z.literal('provider_changed'),
    alias: z.string(),
    from: z.string(),
    to: z.string(),
  }),
  z.strictObject({type: z.literal('write_enabled'), alias: z.string()}),
  z.strictObject({type: z.literal('write_disabled'), alias: z.string()}),
  z.strictObject({
    type: z.literal('selectors_added'),
    alias: z.string(),
    selectors: z.array(z.string()),
  }),
  z.strictObject({
    type: z.literal('selectors_removed'),
    alias: z.string(),
    selectors: z.array(z.string()),
  }),
]);

const declarationChangesSchema = z.strictObject({
  added: jsonObjectSchema,
  removed: jsonObjectSchema,
  changed: z.record(z.string(), z.strictObject({from: z.unknown(), to: z.unknown()})),
});

/** Later pages carry only `source_diff`; the first page carries everything else too. */
export const diffRegistryActionResultSchema = z.strictObject({
  package: registryPackageNameSchema,
  from: registryVersionSchema,
  to: registryVersionSchema,
  bump: registryBumpSchema.optional(),
  capability_changes: z.array(capabilityChangeSchema).optional(),
  manifest_changes: z
    .strictObject({
      inputs: declarationChangesSchema,
      outputs: declarationChangesSchema,
      integrations: declarationChangesSchema,
    })
    .optional(),
  dependency_changes: z
    .array(
      z.strictObject({name: z.string(), from: z.string().nullable(), to: z.string().nullable()}),
    )
    .optional(),
  changelog: z
    .array(z.strictObject({version: registryVersionSchema, markdown: z.string()}))
    .optional(),
  changelog_truncated: z.boolean().optional(),
  source_diff: z.string(),
  next_cursor: cursorSchema.nullable(),
});
export type DiffRegistryActionResultDto = z.output<typeof diffRegistryActionResultSchema>;

function toolJsonSchema(schema: z.ZodType, io: 'input' | 'output'): AgentAccessObjectSchema {
  const {$schema: _, ...jsonSchema} = z.toJSONSchema(schema, {io, unrepresentable: 'any'});
  return {...jsonSchema, type: 'object'};
}

export const listRegistryPackagesInputJsonSchema = toolJsonSchema(
  listRegistryPackagesInputSchema,
  'input',
);
export const listRegistryPackagesResultJsonSchema = toolJsonSchema(
  listRegistryPackagesResultSchema,
  'output',
);
export const getRegistryPackageInputJsonSchema = toolJsonSchema(
  getRegistryPackageInputSchema,
  'input',
);
export const getRegistryPackageResultJsonSchema = toolJsonSchema(
  getRegistryPackageResultSchema,
  'output',
);
export const diffRegistryActionInputJsonSchema = toolJsonSchema(
  diffRegistryActionInputSchema,
  'input',
);
export const diffRegistryActionResultJsonSchema = toolJsonSchema(
  diffRegistryActionResultSchema,
  'output',
);
