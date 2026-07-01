import {
  SENSITIVE_VARIABLE_NAME_WARNING,
  type SecretWriteWarningDto,
  SHORT_SECRET_VALUE_WARNING,
  shouldWarnSensitiveVariableName,
  shouldWarnShortSecretValue,
} from '@shipfox/api-secrets-dto';
import {config} from '#config.js';
import type {ManagementEntry} from '#core/index.js';

export function secretWarnings(entries: ManagementEntry[]): SecretWriteWarningDto[] {
  return entries
    .filter((entry) =>
      shouldWarnShortSecretValue(entry.value, config.SECRETS_SHORT_VALUE_WARN_LENGTH),
    )
    .map((entry) => ({code: SHORT_SECRET_VALUE_WARNING, key: entry.key}));
}

export function variableWarnings(entries: ManagementEntry[]): SecretWriteWarningDto[] {
  return entries
    .filter((entry) => shouldWarnSensitiveVariableName(entry.key))
    .map((entry) => ({code: SENSITIVE_VARIABLE_NAME_WARNING, key: entry.key}));
}
