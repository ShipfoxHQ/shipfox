import type {SecretDto, VariableDto, VariableListItemDto} from '@shipfox/api-secrets-dto';
import type {SecretManagementRow, VariableManagementListRow} from '#db/index.js';
import type {SecretVariable} from '#db/schema/variables.js';

export function toSecretDto(secret: SecretManagementRow): SecretDto {
  return {
    key: secret.key,
    project_id: secret.projectId,
    created_at: secret.createdAt.toISOString(),
    updated_at: secret.updatedAt.toISOString(),
    last_edited_by: secret.lastEditedBy,
  };
}

export function toVariableDto(variable: SecretVariable): VariableDto {
  return {
    key: variable.key,
    project_id: variable.projectId,
    value: variable.value,
    created_at: variable.createdAt.toISOString(),
    updated_at: variable.updatedAt.toISOString(),
    last_edited_by: variable.lastEditedBy,
  };
}

export function toVariableListItemDto(variable: VariableManagementListRow): VariableListItemDto {
  return {
    key: variable.key,
    project_id: variable.projectId,
    value: variable.value,
    value_truncated: variable.valueTruncated,
    created_at: variable.createdAt.toISOString(),
    updated_at: variable.updatedAt.toISOString(),
    last_edited_by: variable.lastEditedBy,
  };
}
