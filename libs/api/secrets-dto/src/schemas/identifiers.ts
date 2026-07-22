import {z} from 'zod';

export const SECRET_KEY_PATTERN_SOURCE = '^[A-Z_][A-Z0-9_]*$';
export const SECRET_KEY_PATTERN = new RegExp(SECRET_KEY_PATTERN_SOURCE);
export const SECRET_KEY_MAX_LENGTH = 128;

export const NAMESPACE_PATTERN_SOURCE = '^[a-z0-9]([a-z0-9_/-]*[a-z0-9])?$';
export const NAMESPACE_PATTERN = new RegExp(NAMESPACE_PATTERN_SOURCE);
export const NAMESPACE_MAX_LENGTH = 128;
export const SYSTEM_NAMESPACE_PREFIX = 'system/';

export const SENSITIVE_NAME_PATTERNS = ['TOKEN', 'SECRET', 'PASSWORD', 'KEY'] as const;

export const secretKeySchema = z
  .string()
  .min(1)
  .max(SECRET_KEY_MAX_LENGTH)
  .regex(SECRET_KEY_PATTERN);

export const namespaceSchema = z
  .string()
  .max(NAMESPACE_MAX_LENGTH)
  .refine((namespace) => namespace === '' || NAMESPACE_PATTERN.test(namespace), {
    message: 'Namespace must be empty or a lowercase slug path.',
  });
