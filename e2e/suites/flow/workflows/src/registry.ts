import {
  type RegistryVersionDocument,
  registryTrustedKeySchema,
  registryVersionPath,
  verifyRegistryVersionEnvelope,
} from '@shipfox/registry-format';

/**
 * Reads a version document from the harness's local registry and verifies it under the keys the
 * API trusts, so a test can compare what ran with what the registry signed.
 */
export async function readRegistryVersionDocument(params: {
  package: string;
  version: string;
  kind: RegistryVersionDocument['kind'];
}): Promise<RegistryVersionDocument> {
  const registryUrl = requiredEnv('REGISTRY_URL');
  const trustedKeys = registryTrustedKeySchema
    .array()
    .parse(JSON.parse(requiredEnv('REGISTRY_TRUSTED_KEYS')));
  const response = await fetch(new URL(registryVersionPath(params), registryUrl));
  if (!response.ok) {
    throw new Error(
      `GET ${registryVersionPath(params)} on the E2E registry returned ${response.status}`,
    );
  }
  const {document} = await verifyRegistryVersionEnvelope({
    envelope: await response.json(),
    trustedKeys,
    expected: params,
  });
  return document;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set; run the suite through \`mise run e2e\`.`);
  return value;
}
