import {z} from 'zod';
import {isSensitiveSecretName, isShortSecretValue, secretKeySchema} from './identifiers.js';

export const SHORT_SECRET_VALUE_WARNING = 'short-secret-value';
export const SENSITIVE_VARIABLE_NAME_WARNING = 'sensitive-variable-name';

export const secretWriteWarningSchema = z.object({
  code: z.enum([SHORT_SECRET_VALUE_WARNING, SENSITIVE_VARIABLE_NAME_WARNING]),
  key: secretKeySchema,
});

export type SecretWriteWarningDto = z.infer<typeof secretWriteWarningSchema>;

export function shouldWarnShortSecretValue(value: string, threshold: number): boolean {
  return isShortSecretValue(value, threshold);
}

export function shouldWarnSensitiveVariableName(key: string): boolean {
  return isSensitiveSecretName(key);
}
