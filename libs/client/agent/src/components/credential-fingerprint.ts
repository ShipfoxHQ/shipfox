export function credentialFingerprint(
  fingerprints: Record<string, string>,
  credentialKey: string,
): string | undefined {
  return fingerprints[`credential:${credentialKey}`] ?? fingerprints[credentialKey];
}

export function headerCredentialFingerprint(
  fingerprints: Record<string, string>,
  headerName: string,
): string | undefined {
  return fingerprints[`header:${headerName.trim().toLowerCase()}`];
}
