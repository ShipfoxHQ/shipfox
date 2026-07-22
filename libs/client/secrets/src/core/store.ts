export const STORE_KEY_HELP =
  'Uppercase letters, digits and underscores; must start with a letter or underscore.';

// This policy intentionally lives here so the package core stays independent of transport DTOs.
const STORE_KEY_PATTERN = /^[A-Z_][A-Z0-9_]*$/;
const STORE_KEY_MAX_LENGTH = 128;
const SENSITIVE_NAME_PATTERNS = ['TOKEN', 'SECRET', 'PASSWORD', 'KEY'];

export type StoreScope = {kind: 'workspace'} | {kind: 'project'; projectId: string};

export const workspaceStoreScope: StoreScope = {kind: 'workspace'};

export interface StoreMetadata {
  key: string;
  scope: StoreScope;
  createdAt: string;
  updatedAt: string;
  lastEditedBy: string | null;
}

export type SecretMetadata = StoreMetadata;

export interface VariablePreview extends StoreMetadata {
  value: string;
  valueState: 'preview';
  valueTruncated: boolean;
}

export interface Variable extends StoreMetadata {
  value: string;
  valueState: 'full';
}

export interface StoreWriteWarning {
  code: 'short-secret-value' | 'sensitive-variable-name';
  key: string;
}

export interface PutStoreCommand {
  workspaceId: string;
  key: string;
  value: string;
  scope: StoreScope;
}

export type PutSecretCommand = PutStoreCommand;
export type PutVariableCommand = PutStoreCommand;

export interface DeleteStoreCommand {
  workspaceId: string;
  key: string;
  scope: StoreScope;
}

export function normalizeStoreKey(key: string): string {
  return key.toUpperCase();
}

export function validateStoreKey(key: string): string | undefined {
  return key.length > 0 && key.length <= STORE_KEY_MAX_LENGTH && STORE_KEY_PATTERN.test(key)
    ? undefined
    : STORE_KEY_HELP;
}

export function validateNewStoreKey(
  key: string,
  params: {mode: 'create' | 'edit'; reservedKeys: readonly string[]; kind: 'secret' | 'variable'},
): string | undefined {
  const formatError = validateStoreKey(key);
  if (formatError) return formatError;
  if (params.mode === 'create' && params.reservedKeys.includes(key)) {
    return `A ${params.kind} with this name already exists. Edit it instead.`;
  }
  return undefined;
}

export function shouldWarnShortSecretValue(value: string, threshold: number): boolean {
  return value.length > 0 && value.length < threshold;
}

export function shouldWarnSensitiveVariableName(key: string): boolean {
  return SENSITIVE_NAME_PATTERNS.some((pattern) => key.includes(pattern));
}

export function projectIdFromScope(scope: StoreScope): string | undefined {
  return scope.kind === 'project' ? scope.projectId : undefined;
}

export function scopeFromProjectId(projectId: string | null): StoreScope {
  return projectId ? {kind: 'project', projectId} : workspaceStoreScope;
}
