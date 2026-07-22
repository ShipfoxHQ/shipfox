import {
  SENSITIVE_VARIABLE_NAME_WARNING,
  type SecretWriteWarningDto,
  SHORT_SECRET_VALUE_WARNING,
} from '@shipfox/api-secrets-dto';
import {config} from '#config.js';
import {isSensitiveSecretName, isShortSecretValue} from '#core/identifier-policy.js';
import type {ManagementEntry} from '#core/index.js';

export function secretWarnings(entries: ManagementEntry[]): SecretWriteWarningDto[] {
  return entries
    .filter((entry) => isShortSecretValue(entry.value, config.SECRETS_SHORT_VALUE_WARN_LENGTH))
    .map((entry) => ({code: SHORT_SECRET_VALUE_WARNING, key: entry.key}));
}

export function variableWarnings(entries: ManagementEntry[]): SecretWriteWarningDto[] {
  return entries
    .filter((entry) => isSensitiveSecretName(entry.key))
    .map((entry) => ({code: SENSITIVE_VARIABLE_NAME_WARNING, key: entry.key}));
}
