import type {CheckoutSpec} from '@shipfox/api-integration-spi';
import {REDACTION_PLACEHOLDER, stripUrlCredentials} from '@shipfox/redact';

/**
 * Returns a copy of `spec` that is safe to log: the credential token is masked
 * and any userinfo a provider mistakenly left in `repositoryUrl` is stripped.
 * Returns the original spec unchanged when it has no credentials and the URL is
 * already clean.
 */
export function redactCheckoutSpec(spec: CheckoutSpec): CheckoutSpec {
  const repositoryUrl = stripUrlCredentials(spec.repositoryUrl);
  if (!spec.credentials) {
    return repositoryUrl === spec.repositoryUrl ? spec : {...spec, repositoryUrl};
  }
  return {
    ...spec,
    repositoryUrl,
    credentials: {...spec.credentials, token: REDACTION_PLACEHOLDER},
  };
}
