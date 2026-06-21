import {secretWireForms} from '@shipfox/redact';

/**
 * One deduped, longest-first variant set for registered-secret masking. Each secret fans out
 * to all its wire forms (base64/base64url/url/hex); longest-first so a secret that is a prefix
 * of another is masked whole. Shared by the streaming output transform and the agent-session
 * stream so the two masking paths can never drift.
 */
export function buildSecretVariants(secrets: string[]): string[] {
  const variants = new Set<string>();
  for (const secret of secrets) {
    for (const form of secretWireForms(secret)) variants.add(form);
  }
  return [...variants].sort((a, b) => b.length - a.length);
}
