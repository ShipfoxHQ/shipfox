export type PublishTokenRefusal =
  | 'invalid-oidc-token'
  | 'oidc-token-replayed'
  | 'publish-grant-not-found'
  | 'namespace-suspended';

/** A publish token request the registry refuses. `detail` is for logs and never reaches the client. */
export class PublishTokenRefusedError extends Error {
  override name = 'PublishTokenRefusedError';
  readonly reason: PublishTokenRefusal;
  readonly detail: string | undefined;

  constructor({
    reason,
    detail,
    cause,
  }: {
    reason: PublishTokenRefusal;
    detail?: string | undefined;
    cause?: unknown;
  }) {
    super(reason, {cause});
    this.reason = reason;
    this.detail = detail;
  }
}

const VERSION_REFUSAL_STATUS = {
  'invalid-publish-token': 401,
  'namespace-mismatch': 403,
  'namespace-suspended': 403,
  'invalid-request': 400,
  'invalid-package-name': 400,
  'reserved-name': 403,
  'kind-mismatch': 409,
  'invalid-draft': 422,
  'invalid-bundle': 422,
  'invalid-manifest': 422,
  'invalid-metadata': 422,
  'unsupported-composition': 422,
  'invalid-template': 422,
  'bump-too-low': 422,
  'action-not-found': 422,
  'changed-without-version-bump': 409,
  'too-large': 413,
} as const;

export type VersionRefusal = keyof typeof VERSION_REFUSAL_STATUS;

/**
 * A publish the registry refuses. The caller holds a verified publish token, so the message says
 * what to fix, unlike a refused token exchange.
 */
export class VersionRefusedError extends Error {
  override name = 'VersionRefusedError';
  readonly reason: VersionRefusal;

  constructor(reason: VersionRefusal, message: string, options?: {cause?: unknown}) {
    super(message, options);
    this.reason = reason;
  }

  get status(): number {
    return VERSION_REFUSAL_STATUS[this.reason];
  }
}
