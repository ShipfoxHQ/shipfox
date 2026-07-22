import type {
  SecretDto,
  SecretWriteWarningDto,
  VariableDto,
  VariableListItemDto,
} from '@shipfox/api-secrets-dto';
import type {
  SecretMetadata,
  StoreMetadata,
  StoreWriteWarning,
  Variable,
  VariablePreview,
} from '#core/store.js';
import {scopeFromProjectId} from '#core/store.js';

function toStoreMetadata(item: SecretDto): StoreMetadata {
  return {
    key: item.key,
    scope: scopeFromProjectId(item.project_id),
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    lastEditedBy: item.last_edited_by,
  };
}

export function toSecretMetadata(secret: SecretDto): SecretMetadata {
  return toStoreMetadata(secret);
}

export function toVariablePreview(variable: VariableListItemDto): VariablePreview {
  return {
    ...toStoreMetadata(variable),
    value: variable.value,
    valueState: 'preview',
    valueTruncated: variable.value_truncated,
  };
}

export function toVariable(variable: VariableDto): Variable {
  return {...toStoreMetadata(variable), value: variable.value, valueState: 'full'};
}

export function toStoreWriteWarnings(
  warnings: readonly SecretWriteWarningDto[],
): StoreWriteWarning[] {
  return warnings.map((warning) => ({code: warning.code, key: warning.key}));
}
