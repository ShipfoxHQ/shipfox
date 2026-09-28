import {
  registryDigestSchema,
  registryPackageKindSchema,
  registryPackageNameSchema,
  registryVersionDocumentSchema,
  registryVersionSchema,
} from '@shipfox/registry-format';
import {z} from 'zod';

export const registryVersionRefSchema = z.object({
  package: registryPackageNameSchema,
  version: registryVersionSchema,
});
export type RegistryVersionRefDto = z.infer<typeof registryVersionRefSchema>;

export const resolveRegistryVersionRequestSchema = registryVersionRefSchema.extend({
  kind: registryPackageKindSchema,
});
export type ResolveRegistryVersionRequestDto = z.infer<typeof resolveRegistryVersionRequestSchema>;

// Inter-module calls carry JSON only, so bundles travel as base64 strings.
export const resolvedRegistryVersionSchema = z.object({
  /** Digest of the content bundle. */
  digest: registryDigestSchema,
  /** The signed version document, verified against the instance's trusted keys. */
  document: registryVersionDocumentSchema,
  /** Base64 of the gzip content bundle, whose digest was checked. */
  content: z.base64(),
});
export type ResolvedRegistryVersionDto = z.infer<typeof resolvedRegistryVersionSchema>;

export const registrySourceSchema = z.object({
  /** Base64 of the gzip source archive, whose digest was checked. */
  source: z.base64(),
});
export type RegistrySourceDto = z.infer<typeof registrySourceSchema>;

export const registryReadmeSchema = z.object({
  readme: z.string().nullable(),
});
export type RegistryReadmeDto = z.infer<typeof registryReadmeSchema>;
