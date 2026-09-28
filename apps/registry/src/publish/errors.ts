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
