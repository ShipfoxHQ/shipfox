import {readFile} from 'node:fs/promises';
import {
  parseRegistryPackageName,
  registryPackageNameSchema,
  registrySlugSchema,
} from '@shipfox/registry-format';
import {parse as parseYaml} from 'yaml';
import {z} from 'zod';

const numericIdSchema = z.string().regex(/^\d+$/, 'must be a numeric id, as a string');

const publisherSchema = z.strictObject({
  provider: z.literal('github'),
  repository_id: numericIdSchema,
  repository_owner_id: numericIdSchema,
  /** Display only: grants match the numeric ids, which survive renames. */
  repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'must be owner/name'),
  workflow: z
    .string()
    .regex(/^\.github\/workflows\/[\w.-]+\.ya?ml$/, 'must be a .github/workflows/ file'),
  environment: z.string().min(1).optional(),
  ref: z.array(z.string().min(1)).min(1).optional(),
  runner_environment: z.enum(['github-hosted', 'self-hosted']).default('github-hosted'),
});

const namespaceSchema = z.strictObject({
  status: z.enum(['active', 'suspended']).default('active'),
  profile: z.strictObject({
    display_name: z.string().min(1).max(80),
    url: z.url({protocol: /^https?$/}).optional(),
    verified: z.boolean().default(false),
  }),
  owner: z.strictObject({workspace_id: z.uuid()}).optional(),
  publishers: z.array(publisherSchema).default([]),
});

const bootstrapSchema = z
  .strictObject({
    issuer: z.url().optional(),
    reserved: z
      .array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*(?:-?\*)?$/, 'must be a slug or slug-*'))
      .default([]),
    featured: z.array(registryPackageNameSchema).default([]),
    namespaces: z.record(registrySlugSchema, namespaceSchema),
  })
  .superRefine((bootstrap, context) => {
    const seen = new Set<string>();
    for (const [index, packageName] of bootstrap.featured.entries()) {
      const namespace = parseRegistryPackageName(packageName)?.namespace;
      if (seen.has(packageName)) {
        context.addIssue({code: 'custom', path: ['featured', index], message: 'is listed twice'});
      } else if (namespace && !(namespace in bootstrap.namespaces)) {
        context.addIssue({
          code: 'custom',
          path: ['featured', index],
          message: `names namespace ${namespace}, which is not declared`,
        });
      }
      seen.add(packageName);
    }
  });

export type RegistryBootstrap = z.infer<typeof bootstrapSchema>;
export type RegistryBootstrapNamespace = RegistryBootstrap['namespaces'][string];

export class BootstrapError extends Error {
  constructor(path: string, reason: string) {
    super(`Invalid registry bootstrap file ${path}: ${reason}`);
    this.name = 'BootstrapError';
  }
}

export async function loadBootstrap(path: string): Promise<RegistryBootstrap> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    throw new BootstrapError(path, error instanceof Error ? error.message : String(error));
  }
  return parseBootstrap({path, text});
}

export function parseBootstrap({path, text}: {path: string; text: string}): RegistryBootstrap {
  let document: unknown;
  try {
    document = parseYaml(text);
  } catch (error) {
    throw new BootstrapError(path, error instanceof Error ? error.message : String(error));
  }
  const parsed = bootstrapSchema.safeParse(document);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`,
    );
    throw new BootstrapError(path, issues.join('; '));
  }
  return parsed.data;
}
