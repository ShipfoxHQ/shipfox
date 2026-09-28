import {z} from 'zod';
import type {WorkflowTemplateManifest} from './manifest.js';

export const workflowTemplateMetadataSchema = z.object({
  /** Providers of every role, sorted and unique. */
  integrations: z.array(z.string()),
  interface: z.object({
    slots: z.array(z.object({id: z.string(), description: z.string()})),
    secrets: z.array(z.object({name: z.string(), description: z.string()})),
    variables: z.array(z.object({name: z.string(), description: z.string()})),
  }),
  /** The questions a user answers to adopt the template: which providers, and which options. */
  choices: z.object({
    roles: z.array(
      z.object({
        id: z.string(),
        providers: z.array(z.string()),
        optional: z.boolean(),
        from: z.literal('project').optional(),
        question: z.string().optional(),
        tradeoff: z.string().optional(),
      }),
    ),
    options: z.array(
      z.object({
        id: z.string(),
        question: z.string().optional(),
        tradeoff: z.string().optional(),
        tradeoffs: z.record(z.string(), z.string()).optional(),
        applies_to: z.array(z.string()).optional(),
        choices: z.array(
          z.object({
            id: z.string(),
            label: z.string().optional(),
            default: z.boolean().optional(),
            tradeoff: z.string().optional(),
          }),
        ),
      }),
    ),
  }),
  /** Content bundle bytes. */
  size: z.number().int().nonnegative(),
});

export type WorkflowTemplateMetadata = z.infer<typeof workflowTemplateMetadataSchema>;

export interface DeriveTemplateMetadataParams {
  manifest: WorkflowTemplateManifest;
  contentBytes: number;
}

/**
 * The `derived` field of a template version document. It uses only the
 * manifest: facts that need composition depend on the platform version, so
 * consumers compute them with the composer.
 */
export function deriveTemplateMetadata({
  manifest,
  contentBytes,
}: DeriveTemplateMetadataParams): WorkflowTemplateMetadata {
  const roles = Object.entries(manifest.roles);
  return {
    integrations: [...new Set(roles.flatMap(([, role]) => role.providers))].sort(),
    interface: {
      slots: manifest.slots.map(({id, description}) => ({id, description})),
      secrets: manifest.secrets.map(({name, description}) => ({name, description})),
      variables: manifest.variables.map(({name, description}) => ({name, description})),
    },
    choices: {
      roles: roles.map(([id, role]) => ({
        id,
        providers: [...role.providers],
        optional: role.optional === true,
        from: role.from,
        question: role.question,
        tradeoff: role.tradeoff,
      })),
      options: manifest.options.map((option) => ({
        id: option.id,
        question: option.question,
        tradeoff: option.tradeoff,
        tradeoffs: option.tradeoffs,
        applies_to: option.applies_to,
        choices: option.choices.map(({id, label, default: isDefault, tradeoff}) => ({
          id,
          label,
          default: isDefault,
          tradeoff,
        })),
      })),
    },
    size: contentBytes,
  };
}
