import {instanceMetrics} from '@shipfox/node-opentelemetry';
import {
  DekUnwrapError,
  DekWrapError,
  KekVersionStrandedError,
  NamespaceValidationError,
  SecretBatchDuplicateKeyError,
  SecretBatchScopeMismatchError,
  SecretDecryptionError,
  SecretKeyValidationError,
  SecretNotFoundError,
  SecretValueTooLargeError,
  UnknownSecretStoreError,
  VariableNotFoundError,
  WorkspaceSecretCapExceededError,
} from '#core/errors.js';

const meter = instanceMetrics.getMeter('secrets');

export type SecretsMetricResource = 'secret' | 'variable';
export type SecretsMetricOperation = 'get' | 'get_namespace' | 'set' | 'delete' | 'list';
export type SecretsMetricSurface = 'internal' | 'management';
export type SecretsMetricScope = 'workspace' | 'project';
export type SecretsOperationOutcome =
  | 'success'
  | 'not_found'
  | 'validation_failed'
  | 'cap_exceeded'
  | 'value_too_large'
  | 'decryption_failed'
  | 'crypto_failed'
  | 'failure';
export type SecretsMutationEffect = 'created' | 'updated' | 'deleted';
export type SecretsDekAccessOutcome =
  | 'cache_hit'
  | 'cache_expired'
  | 'db_unwrapped'
  | 'generated'
  | 'unwrap_failed'
  | 'wrap_failed'
  | 'persist_failed';
export type SecretsKekRotationOutcome =
  | 'rotated'
  | 'skipped_current'
  | 'skipped_race'
  | 'stranded'
  | 'failure';

const operationCount = meter.createCounter<{
  resource: SecretsMetricResource;
  operation: SecretsMetricOperation;
  surface: SecretsMetricSurface;
  scope: SecretsMetricScope;
  outcome: SecretsOperationOutcome;
}>('secrets_operation', {
  description: 'Secrets module operation attempts by resource, surface, scope, and outcome',
});

const operationDuration = meter.createHistogram<{
  resource: SecretsMetricResource;
  operation: SecretsMetricOperation;
  surface: SecretsMetricSurface;
  scope: SecretsMetricScope;
  outcome: SecretsOperationOutcome;
}>('secrets_operation_duration', {
  description: 'Secrets module operation duration',
  unit: 'ms',
  advice: {explicitBucketBoundaries: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]},
});

const entriesMutatedCount = meter.createCounter<{
  resource: SecretsMetricResource;
  operation: 'set' | 'delete';
  effect: SecretsMutationEffect;
  surface: SecretsMetricSurface;
}>('secrets_entries_mutated', {
  description: 'Secret and variable entries mutated by operation, effect, and surface',
});

const dekAccessCount = meter.createCounter<{outcome: SecretsDekAccessOutcome}>(
  'secrets_dek_access',
  {description: 'Plaintext data-encryption key access attempts by outcome'},
);

const dekAccessDuration = meter.createHistogram<{outcome: SecretsDekAccessOutcome}>(
  'secrets_dek_access_duration',
  {
    description: 'Plaintext data-encryption key access duration',
    unit: 'ms',
    advice: {explicitBucketBoundaries: [0, 1, 5, 10, 25, 50, 100, 250, 500, 1000]},
  },
);

const kekRotationCount = meter.createCounter<{outcome: SecretsKekRotationOutcome}>(
  'secrets_kek_rotation',
  {description: 'Workspace data-key KEK rotation outcomes'},
);

const kekRotationDuration = meter.createHistogram<{outcome: SecretsKekRotationOutcome}>(
  'secrets_kek_rotation_duration',
  {
    description: 'Workspace data-key KEK rotation duration',
    unit: 'ms',
    advice: {explicitBucketBoundaries: [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000]},
  },
);

function recordMetric(record: () => void): void {
  try {
    record();
  } catch {
    // Metrics must not affect secret storage outcomes.
  }
}

export function operationScope(params: {
  projectId?: string | null | undefined;
}): SecretsMetricScope {
  return params.projectId ? 'project' : 'workspace';
}

export function classifySecretsOperationError(error: unknown): SecretsOperationOutcome {
  if (error instanceof SecretNotFoundError || error instanceof VariableNotFoundError) {
    return 'not_found';
  }
  if (error instanceof WorkspaceSecretCapExceededError) return 'cap_exceeded';
  if (error instanceof SecretValueTooLargeError) return 'value_too_large';
  if (error instanceof SecretDecryptionError) return 'decryption_failed';
  if (error instanceof DekUnwrapError || error instanceof DekWrapError) return 'crypto_failed';
  if (
    error instanceof NamespaceValidationError ||
    error instanceof SecretKeyValidationError ||
    error instanceof SecretBatchDuplicateKeyError ||
    error instanceof SecretBatchScopeMismatchError ||
    error instanceof UnknownSecretStoreError
  ) {
    return 'validation_failed';
  }
  return 'failure';
}

export function recordSecretsOperation(params: {
  resource: SecretsMetricResource;
  operation: SecretsMetricOperation;
  surface: SecretsMetricSurface;
  scope: SecretsMetricScope;
  outcome: SecretsOperationOutcome;
  durationMs: number;
}): void {
  recordMetric(() => {
    const labels = {
      resource: params.resource,
      operation: params.operation,
      surface: params.surface,
      scope: params.scope,
      outcome: params.outcome,
    };
    operationCount.add(1, labels);
    operationDuration.record(params.durationMs, labels);
  });
}

export function recordSecretsEntriesMutated(params: {
  resource: SecretsMetricResource;
  operation: 'set' | 'delete';
  effect: SecretsMutationEffect;
  surface: SecretsMetricSurface;
  count: number;
}): void {
  if (params.count <= 0) return;

  recordMetric(() =>
    entriesMutatedCount.add(params.count, {
      resource: params.resource,
      operation: params.operation,
      effect: params.effect,
      surface: params.surface,
    }),
  );
}

export function recordSecretsDekAccess(params: {
  outcome: SecretsDekAccessOutcome;
  durationMs: number;
}): void {
  recordMetric(() => {
    dekAccessCount.add(1, {outcome: params.outcome});
    dekAccessDuration.record(params.durationMs, {outcome: params.outcome});
  });
}

export function classifyDekAccessError(error: unknown): SecretsDekAccessOutcome {
  if (error instanceof DekUnwrapError) return 'unwrap_failed';
  if (error instanceof DekWrapError) return 'wrap_failed';
  return 'persist_failed';
}

export function recordSecretsKekRotation(params: {
  outcome: SecretsKekRotationOutcome;
  count?: number | undefined;
  durationMs?: number | undefined;
}): void {
  const count = params.count ?? 1;
  if (count <= 0 && params.durationMs === undefined) return;

  recordMetric(() => {
    if (count > 0) kekRotationCount.add(count, {outcome: params.outcome});
    if (params.durationMs !== undefined) {
      kekRotationDuration.record(params.durationMs, {outcome: params.outcome});
    }
  });
}

export function classifyKekRotationError(error: unknown): SecretsKekRotationOutcome {
  if (error instanceof KekVersionStrandedError) return 'stranded';
  if (error instanceof DekUnwrapError || error instanceof DekWrapError) return 'failure';
  return 'failure';
}
