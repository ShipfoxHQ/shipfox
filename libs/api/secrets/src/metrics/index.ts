export {
  classifyDekAccessError,
  classifyKekRotationError,
  classifySecretsOperationError,
  operationScope,
  recordSecretsDekAccess,
  recordSecretsEntriesMutated,
  recordSecretsKekRotation,
  recordSecretsOperation,
  type SecretsDekAccessOutcome,
  type SecretsKekRotationOutcome,
  type SecretsMetricOperation,
  type SecretsMetricResource,
  type SecretsMetricScope,
  type SecretsMetricSurface,
  type SecretsMutationEffect,
  type SecretsOperationOutcome,
} from './instance.js';
export {registerSecretsServiceMetrics} from './service.js';
