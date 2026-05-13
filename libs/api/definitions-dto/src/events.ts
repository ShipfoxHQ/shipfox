import type {TriggerDto} from '#schemas/trigger.js';

export const DEFINITION_RESOLVED = 'definitions.definition.resolved' as const;
export const DEFINITION_DELETED = 'definitions.definition.deleted' as const;
export const DEFINITION_INVALID = 'definitions.definition.invalid' as const;

export interface DefinitionResolvedEvent {
  definitionId: string;
  projectId: string;
  workspaceId: string;
  configPath: string | null;
  triggers: Record<string, TriggerDto>;
}

export interface DefinitionDeletedEvent {
  definitionId: string;
  projectId: string;
  workspaceId: string;
}

export interface DefinitionInvalidEvent {
  projectId: string;
  ref: string;
  errors: string[];
}

export interface DefinitionsEventMap {
  [DEFINITION_RESOLVED]: DefinitionResolvedEvent;
  [DEFINITION_DELETED]: DefinitionDeletedEvent;
  [DEFINITION_INVALID]: DefinitionInvalidEvent;
}
