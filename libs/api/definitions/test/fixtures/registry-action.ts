import {Buffer} from 'node:buffer';
import {
  type RegistryInterModuleClient,
  registryInterModuleContract,
} from '@shipfox/api-registry-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {type ActionBundleFile, encodeActionBundle} from '@shipfox/workflow-document';

export const REGISTRY_ACTION_REF = 'shipfox/slack-thread-digest@1.4.2';
export const REGISTRY_ACTION_MANIFEST_YAML = 'name: Slack thread digest\nmain: index.mjs\n';

export type RegistryVersionResult = Awaited<
  ReturnType<RegistryInterModuleClient['resolveVersion']>
>;

/** A `resolveVersion` result for a bundled action, with a signed document that names its manifest. */
export async function registryVersion(
  overrides: {files?: ActionBundleFile[]; manifest?: Record<string, unknown>} = {},
): Promise<RegistryVersionResult> {
  const files = overrides.files ?? [
    {path: 'action.yml', content: REGISTRY_ACTION_MANIFEST_YAML},
    {path: 'index.mjs', content: 'export default 1;\n'},
  ];
  const bundle = await encodeActionBundle({files});
  return {
    digest: bundle.digest,
    content: Buffer.from(bundle.gzip).toString('base64'),
    // Only the fields the resolver reads. Production documents carry more.
    document: {
      kind: 'action',
      package: 'shipfox/slack-thread-digest',
      version: '1.4.2',
      content: {digest: bundle.digest, bytes: bundle.bytes, format: 'action-bundle@1'},
      manifest: overrides.manifest ?? {name: 'Slack thread digest', main: 'index.mjs'},
    } as RegistryVersionResult['document'],
  };
}

export function fakeRegistry(result: RegistryVersionResult | Error) {
  return {
    resolveVersion: vi.fn(() =>
      result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
    ),
  } satisfies Pick<RegistryInterModuleClient, 'resolveVersion'>;
}

export function registryError(
  code:
    | 'registry-version-not-found'
    | 'registry-signature-invalid'
    | 'registry-schema-unsupported'
    | 'registry-unavailable'
    | 'registry-disabled',
): Error {
  const details =
    code === 'registry-unavailable' || code === 'registry-disabled'
      ? {}
      : {package: 'shipfox/slack-thread-digest', version: '1.4.2'};
  return createInterModuleKnownError(
    registryInterModuleContract.methods.resolveVersion,
    code as 'registry-unavailable',
    details as Record<string, never>,
  );
}
