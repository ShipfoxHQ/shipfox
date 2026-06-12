import type {CheckoutSpec} from '@shipfox/api-integration-core';
import type {CheckoutTokenResponseDto} from '@shipfox/api-workflows-dto';

// Defense in depth: createCheckoutSpec's contract is that `repositoryUrl` never
// embeds credentials (they live in `credentials` so redaction can mask them). A
// provider bug that put a token in the URL would bypass redaction and leak it
// into `git remote -v` and logs, so reject it before it reaches the runner.
function assertNoEmbeddedCredentials(repositoryUrl: string): void {
  let url: URL;
  try {
    url = new URL(repositoryUrl);
  } catch {
    // scp-like forms (git@host:org/repo.git) are not URLs and carry no password.
    return;
  }
  if (url.username || url.password) {
    throw new Error('Checkout repository URL must not embed credentials');
  }
}

export function toCheckoutTokenDto(spec: CheckoutSpec): CheckoutTokenResponseDto {
  assertNoEmbeddedCredentials(spec.repositoryUrl);

  // Every provider that returns credentials uses a username (GitHub:
  // 'x-access-token'), so the response is always basic auth; a credential-free
  // spec (debug) omits auth entirely.
  return {
    repository_url: spec.repositoryUrl,
    ref: spec.ref,
    ...(spec.credentials
      ? {
          auth: {
            kind: 'basic' as const,
            username: spec.credentials.username,
            token: spec.credentials.token,
            expires_at: spec.credentials.expiresAt.toISOString(),
          },
        }
      : {}),
  };
}
