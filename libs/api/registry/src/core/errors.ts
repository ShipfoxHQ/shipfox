export class RegistryDisabledError extends Error {
  override name = 'RegistryDisabledError';

  constructor() {
    super('The registry is disabled: REGISTRY_URL is empty');
  }
}

export class RegistryUnavailableError extends Error {
  override name = 'RegistryUnavailableError';
}

interface RegistryVersionRef {
  package: string;
  version: string;
}

abstract class RegistryVersionError extends Error {
  readonly package: string;
  readonly version: string;

  constructor(params: RegistryVersionRef & {message: string}) {
    super(params.message);
    this.package = params.package;
    this.version = params.version;
  }
}

export class RegistryVersionNotFoundError extends RegistryVersionError {
  override name = 'RegistryVersionNotFoundError';

  constructor(params: RegistryVersionRef) {
    super({
      ...params,
      message: `The registry has no version ${params.version} of ${params.package}`,
    });
  }
}

export type RegistrySignatureInvalidReason =
  | 'malformed'
  | 'signature-invalid'
  | 'payload-mismatch'
  | 'digest-mismatch';

export class RegistrySignatureInvalidError extends RegistryVersionError {
  override name = 'RegistrySignatureInvalidError';
  readonly reason: RegistrySignatureInvalidReason;

  constructor(params: RegistryVersionRef & {reason: RegistrySignatureInvalidReason}) {
    super({
      ...params,
      message: `Version ${params.version} of ${params.package} failed verification: ${params.reason}`,
    });
    this.reason = params.reason;
  }
}

export class RegistrySchemaUnsupportedError extends RegistryVersionError {
  override name = 'RegistrySchemaUnsupportedError';

  constructor(params: RegistryVersionRef) {
    super({
      ...params,
      message: `Version ${params.version} of ${params.package} uses an unsupported document schema`,
    });
  }
}
