import {z} from 'zod';
import {triggerDtoSchema} from '#schemas/trigger.js';

const nonEmptyStringSchema = z.string().nonempty();

export const DEFINITION_RESOLVED = 'definitions.definition.resolved' as const;
export const DEFINITION_DELETED = 'definitions.definition.deleted' as const;
export const DEFINITION_INVALID = 'definitions.definition.invalid' as const;
export const DEFINITION_AGENT_RULES_RESOLVED = 'definitions.agent_rules.resolved' as const;

export const definitionResolvedEventSchema = z.object({
  definitionId: nonEmptyStringSchema,
  projectId: nonEmptyStringSchema,
  workspaceId: nonEmptyStringSchema,
  actorUserId: nonEmptyStringSchema.optional(),
  configPath: z.string().nullable(),
  triggers: z.record(z.string(), triggerDtoSchema),
});
export type DefinitionResolvedEvent = z.infer<typeof definitionResolvedEventSchema>;

export const definitionDeletedEventSchema = z.object({
  definitionId: nonEmptyStringSchema,
  projectId: nonEmptyStringSchema,
  workspaceId: nonEmptyStringSchema,
});
export type DefinitionDeletedEvent = z.infer<typeof definitionDeletedEventSchema>;

export const definitionInvalidEventSchema = z.object({
  projectId: nonEmptyStringSchema,
  ref: nonEmptyStringSchema,
  errors: z.array(z.string()),
});
export type DefinitionInvalidEvent = z.infer<typeof definitionInvalidEventSchema>;

export const agentRuleDtoSchema = z.object({
  source: nonEmptyStringSchema,
  filter: nonEmptyStringSchema.optional(),
});
export type AgentRuleDto = z.infer<typeof agentRuleDtoSchema>;

/**
 * Every `on:` rule of the project's agents after a sync, so a reader replaces the project's
 * claims instead of merging them. An agent with no rule is absent. An agent whose file is
 * invalid keeps the rules of its last valid version.
 */
export const definitionAgentRulesResolvedEventSchema = z.object({
  workspaceId: nonEmptyStringSchema,
  projectId: nonEmptyStringSchema,
  agents: z.array(z.object({key: nonEmptyStringSchema, rules: z.array(agentRuleDtoSchema).min(1)})),
});
export type DefinitionAgentRulesResolvedEvent = z.infer<
  typeof definitionAgentRulesResolvedEventSchema
>;

export interface DefinitionsEventMap {
  [DEFINITION_RESOLVED]: DefinitionResolvedEvent;
  [DEFINITION_DELETED]: DefinitionDeletedEvent;
  [DEFINITION_INVALID]: DefinitionInvalidEvent;
  [DEFINITION_AGENT_RULES_RESOLVED]: DefinitionAgentRulesResolvedEvent;
}

export const definitionsEventSchemas = {
  [DEFINITION_RESOLVED]: definitionResolvedEventSchema,
  [DEFINITION_DELETED]: definitionDeletedEventSchema,
  [DEFINITION_INVALID]: definitionInvalidEventSchema,
  [DEFINITION_AGENT_RULES_RESOLVED]: definitionAgentRulesResolvedEventSchema,
} satisfies Record<keyof DefinitionsEventMap, z.ZodType>;
