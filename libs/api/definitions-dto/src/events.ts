import {z} from 'zod';

export const DEFINITION_RESOLVED = 'definitions.definition.resolved' as const;
export const DEFINITION_DELETED = 'definitions.definition.deleted' as const;
export const DEFINITION_INVALID = 'definitions.definition.invalid' as const;

const triggerEventSchema = z.object({
  source: z.string(),
  event: z.string(),
  with: z.record(z.string(), z.unknown()).optional(),
  filter: z.string().optional(),
});

export const definitionResolvedEventSchema = z.object({
  definitionId: z.string(),
  projectId: z.string(),
  workspaceId: z.string(),
  configPath: z.string().nullable(),
  triggers: z.record(z.string(), triggerEventSchema),
});
export type DefinitionResolvedEvent = z.infer<typeof definitionResolvedEventSchema>;

export const definitionDeletedEventSchema = z.object({
  definitionId: z.string(),
  projectId: z.string(),
  workspaceId: z.string(),
});
export type DefinitionDeletedEvent = z.infer<typeof definitionDeletedEventSchema>;

export const definitionInvalidEventSchema = z.object({
  projectId: z.string(),
  ref: z.string(),
  errors: z.array(z.string()),
});
export type DefinitionInvalidEvent = z.infer<typeof definitionInvalidEventSchema>;

export interface DefinitionsEventMap {
  [DEFINITION_RESOLVED]: DefinitionResolvedEvent;
  [DEFINITION_DELETED]: DefinitionDeletedEvent;
  [DEFINITION_INVALID]: DefinitionInvalidEvent;
}

export const definitionsEventSchemas = {
  [DEFINITION_RESOLVED]: definitionResolvedEventSchema,
  [DEFINITION_DELETED]: definitionDeletedEventSchema,
  [DEFINITION_INVALID]: definitionInvalidEventSchema,
} satisfies Record<keyof DefinitionsEventMap, z.ZodType>;
