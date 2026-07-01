export class SecretDecryptionError extends Error {
  constructor() {
    super('Secret value could not be decrypted.');
    this.name = 'SecretDecryptionError';
  }
}

export class DekWrapError extends Error {
  constructor() {
    super('Data encryption key could not be wrapped.');
    this.name = 'DekWrapError';
  }
}

export class DekUnwrapError extends Error {
  constructor() {
    super('Data encryption key could not be unwrapped.');
    this.name = 'DekUnwrapError';
  }
}

export class KekConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KekConfigurationError';
  }
}

export class SecretKeyValidationError extends Error {
  constructor(public readonly key: string) {
    super(`Invalid secret key: ${key}`);
    this.name = 'SecretKeyValidationError';
  }
}

export class NamespaceValidationError extends Error {
  constructor(public readonly namespace: string) {
    super(`Invalid secret namespace: ${namespace}`);
    this.name = 'NamespaceValidationError';
  }
}

export class WorkspaceSecretCapExceededError extends Error {
  constructor(
    public readonly workspaceId: string,
    public readonly cap: number,
  ) {
    super(`Workspace ${workspaceId} exceeds the secret and variable cap of ${cap}.`);
    this.name = 'WorkspaceSecretCapExceededError';
  }
}

export class SecretValueTooLargeError extends Error {
  constructor(public readonly maxBytes: number) {
    super(`Secret and variable values must not exceed ${maxBytes} bytes.`);
    this.name = 'SecretValueTooLargeError';
  }
}

export class SecretBatchScopeMismatchError extends Error {
  constructor() {
    super('Secret and variable batches must target a single project scope.');
    this.name = 'SecretBatchScopeMismatchError';
  }
}

export class SecretNotFoundError extends Error {
  constructor(public readonly key: string) {
    super(`Secret not found: ${key}`);
    this.name = 'SecretNotFoundError';
  }
}

export class VariableNotFoundError extends Error {
  constructor(public readonly key: string) {
    super(`Variable not found: ${key}`);
    this.name = 'VariableNotFoundError';
  }
}

export class UnknownSecretStoreError extends Error {
  constructor(public readonly store: string) {
    super(`Unknown secret store: ${store.slice(0, 64)}`);
    this.name = 'UnknownSecretStoreError';
  }
}

export class KekVersionStrandedError extends Error {
  constructor(public readonly kekVersion: string) {
    super(`Data key is stranded on unknown KEK version: ${kekVersion}`);
    this.name = 'KekVersionStrandedError';
  }
}
