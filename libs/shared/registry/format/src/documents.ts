import {z} from 'zod';
import {registryActionMetadataSchema} from '#actions.js';
import {decodeBase64} from '#base64.js';
import {
  registryPackageNameSchema,
  registryReferenceSchema,
  registrySlugSchema,
  registryVersionSchema,
} from '#reference.js';

export const REGISTRY_VERSION_DOCUMENT_SCHEMA = 'shipfox.registry/version@1';
export const REGISTRY_VERSION_PAYLOAD_TYPE = 'application/vnd.shipfox.registry.version+json';
export const REGISTRY_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

export const REGISTRY_PACKAGE_KINDS = ['action', 'template'] as const;
export const REGISTRY_BUMPS = ['major', 'minor', 'patch'] as const;

export const registryDigestSchema = z.string().regex(REGISTRY_DIGEST_PATTERN);
export const registryPackageKindSchema = z.enum(REGISTRY_PACKAGE_KINDS);
export const registryBumpSchema = z.enum(REGISTRY_BUMPS);

const timestampSchema = z.iso.datetime();
const byteCountSchema = z.number().int().nonnegative();
const jsonObjectSchema = z.record(z.string(), z.unknown());

const blobSchema = z.object({digest: registryDigestSchema, bytes: byteCountSchema});

const builderSchema = z.object({
  tool: z.string().min(1),
  version: z.string().min(1),
  recipe: z.number().int().positive(),
  mode: z.enum(['workspace']).optional(),
});

const provenanceSchema = z.object({
  issuer: z.url(),
  repository: z.string().min(1),
  repository_id: z.string().min(1),
  repository_owner_id: z.string().min(1),
  commit: z.string().min(1),
  ref: z.string().min(1),
  workflow_ref: z.string().min(1),
  run_id: z.string().min(1),
  run_attempt: z.string().min(1),
  path: z.string().min(1),
});

const versionDocumentBaseSchema = z.object({
  schema: z.literal(REGISTRY_VERSION_DOCUMENT_SCHEMA),
  package: registryPackageNameSchema,
  version: registryVersionSchema,
  visibility: z.enum(['public']),
  fingerprint: registryDigestSchema,
  published_at: timestampSchema,
  license: z.string().min(1),
  source: blobSchema.extend({format: z.literal('source-archive@1')}),
  readme: blobSchema.optional(),
  manifest: jsonObjectSchema,
  derived: jsonObjectSchema,
  actions: z.array(registryReferenceSchema),
  changelog: z.string().optional(),
  /** Absent on a package's first version, which has nothing to compare with. */
  bump: registryBumpSchema.optional(),
  builder: builderSchema,
  provenance: provenanceSchema,
});

export const registryActionVersionDocumentSchema = versionDocumentBaseSchema.extend({
  kind: z.literal('action'),
  derived: registryActionMetadataSchema,
  content: blobSchema.extend({format: z.literal('action-bundle@1')}),
  dependencies: z.array(z.object({name: z.string().min(1), version: z.string().min(1)})),
});

export const registryTemplateVersionDocumentSchema = versionDocumentBaseSchema.extend({
  kind: z.literal('template'),
  content: blobSchema.extend({format: z.literal('template-bundle@1')}),
  composition: z.number().int().positive(),
});

/** The signed payload of a version envelope, `v1/packages/<ns>/<name>/versions/<v>.json`. */
export const registryVersionDocumentSchema = z.discriminatedUnion('kind', [
  registryActionVersionDocumentSchema,
  registryTemplateVersionDocumentSchema,
]);

/** `v1/packages/<ns>/<name>/index.json`. Unsigned and mutable. */
export const registryPackageIndexSchema = z.object({
  package: registryPackageNameSchema,
  kind: registryPackageKindSchema,
  versions: z.array(
    z.object({
      version: registryVersionSchema,
      digest: registryDigestSchema,
      published_at: timestampSchema,
      bump: registryBumpSchema.optional(),
      capability_change: z.boolean(),
    }),
  ),
});

export const registryCatalogEntrySchema = z.object({
  package: registryPackageNameSchema,
  kind: registryPackageKindSchema,
  title: z.string().min(1),
  summary: z.string(),
  keywords: z.array(z.string()),
  integrations: z.array(z.string()),
  latest: registryVersionSchema,
  published_at: timestampSchema,
  first_published_at: timestampSchema,
  /** Position in the operator's `featured` list, starting at 1. */
  featured: z.number().int().positive().optional(),
  publisher: z.object({
    namespace: registrySlugSchema,
    display_name: z.string().min(1),
    verified: z.boolean(),
  }),
});

/** `v1/index.json`. Unsigned and mutable. */
export const registryCatalogSchema = z.object({
  packages: z.array(registryCatalogEntrySchema),
});

/** `v1/namespaces/<ns>.json`. Unsigned and mutable. */
export const registryNamespaceProfileSchema = z.object({
  namespace: registrySlugSchema,
  display_name: z.string().min(1),
  url: z.url().optional(),
  verified: z.boolean(),
});

const ED25519_SPKI_PREFIX = [
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
];

function isEd25519PublicKey(value: string): boolean {
  const bytes = decodeBase64(value);
  return (
    bytes?.length === ED25519_SPKI_PREFIX.length + 32 &&
    ED25519_SPKI_PREFIX.every((byte, index) => bytes[index] === byte)
  );
}

/**
 * An Ed25519 public key as base64 DER SubjectPublicKeyInfo: the body of the
 * PEM that `openssl pkey -pubout` writes, without the armor lines.
 */
export const registryEd25519PublicKeySchema = z
  .string()
  .refine(isEd25519PublicKey, 'Expected a base64 DER Ed25519 public key');

export const registryPublicKeySchema = z.object({
  keyid: z.string().min(1),
  algorithm: z.literal('ed25519'),
  public_key: registryEd25519PublicKeySchema,
});

/** A key an instance trusts for version envelopes, from its own configuration. */
export const registryTrustedKeySchema = registryPublicKeySchema.pick({
  keyid: true,
  public_key: true,
});

/**
 * `.well-known/shipfox-registry.json`. Informational only: instances trust the
 * keys in their own configuration, never the keys listed here.
 */
export const registryMetadataSchema = z.object({
  publish_url: z.url(),
  keys: z.array(registryPublicKeySchema),
});

export type RegistryPackageKind = z.infer<typeof registryPackageKindSchema>;
export type RegistryBump = z.infer<typeof registryBumpSchema>;
export type RegistryActionVersionDocument = z.infer<typeof registryActionVersionDocumentSchema>;
export type RegistryTemplateVersionDocument = z.infer<typeof registryTemplateVersionDocumentSchema>;
export type RegistryVersionDocument = z.infer<typeof registryVersionDocumentSchema>;
export type RegistryPackageIndex = z.infer<typeof registryPackageIndexSchema>;
export type RegistryCatalogEntry = z.infer<typeof registryCatalogEntrySchema>;
export type RegistryCatalog = z.infer<typeof registryCatalogSchema>;
export type RegistryNamespaceProfile = z.infer<typeof registryNamespaceProfileSchema>;
export type RegistryPublicKey = z.infer<typeof registryPublicKeySchema>;
export type RegistryTrustedKey = z.infer<typeof registryTrustedKeySchema>;
export type RegistryMetadata = z.infer<typeof registryMetadataSchema>;
