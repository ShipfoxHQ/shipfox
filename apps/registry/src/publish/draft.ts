import {
  registryActionVersionDocumentSchema,
  registryTemplateVersionDocumentSchema,
} from '@shipfox/registry-format';
import {z} from 'zod';
import {CHANGELOG_LIMIT_BYTES} from '#publish/limits.js';

const {builder, dependencies} = registryActionVersionDocumentSchema.shape;
const {composition} = registryTemplateVersionDocumentSchema.shape;

const draftFields = {
  license: z.string().min(1).max(256),
  changelog: z
    .string()
    .min(1)
    .refine((text) => Buffer.byteLength(text) <= CHANGELOG_LIMIT_BYTES, 'is too long')
    .optional(),
  builder,
  /** Where the package lives in the publishing repository. The registry records it as provenance. */
  path: z
    .string()
    .min(1)
    .max(512)
    .refine(
      (path) =>
        !(path.startsWith('/') || path.includes('\\')) &&
        path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..'),
      'must be a normalized relative path',
    ),
};

/**
 * The `draft` part of a publish: what the release tool knows and the bundles do not. The registry
 * derives everything else, so a draft cannot claim a digest, a bump, or a provenance.
 */
export const publishDraftSchema = z.discriminatedUnion('kind', [
  z.strictObject({...draftFields, kind: z.literal('action'), dependencies}),
  z.strictObject({...draftFields, kind: z.literal('template'), composition}),
]);

export type PublishDraft = z.infer<typeof publishDraftSchema>;
