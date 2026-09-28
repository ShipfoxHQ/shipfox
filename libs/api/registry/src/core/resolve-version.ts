import {createHash} from 'node:crypto';
import {logger} from '@shipfox/node-opentelemetry';
import {
  REGISTRY_PACKAGE_KINDS,
  RegistryEnvelopeError,
  type RegistryPackageKind,
  type RegistryVersionDocument,
  registryBlobPath,
  registryEnvelopeSchema,
  registryVersionPath,
  verifyRegistryVersionEnvelope,
} from '@shipfox/registry-format';
import {decodeActionBundle, InvalidActionBundleError} from '@shipfox/workflow-document';
import {
  deleteRegistryVersion,
  getRegistryVersion,
  insertRegistryVersion,
  setRegistryVersionReadme,
  setRegistryVersionSource,
} from '#db/versions.js';
import {type RegistryFetchResult, registryCacheHit, registryFetch} from '#metrics/instance.js';
import {
  RegistryDisabledError,
  RegistrySchemaUnsupportedError,
  RegistrySignatureInvalidError,
  RegistryUnavailableError,
  RegistryVersionNotFoundError,
} from './errors.js';
import {fetchRegistryFile} from './registry-files.js';
import type {RegistryVersion} from './registry-version.js';
import type {RegistrySettings} from './settings.js';

interface VersionRequest {
  settings: RegistrySettings;
  package: string;
  version: string;
}

/**
 * Returns a version whose signed document verifies under the current trusted
 * keys. `kind` can be omitted when the caller only knows the package and version.
 */
export async function resolveVersion(
  params: VersionRequest & {kind?: RegistryPackageKind | undefined},
): Promise<RegistryVersion> {
  const {settings, package: packageName, version, kind} = params;
  if (settings.registry === '') throw new RegistryDisabledError();

  const key = {registry: settings.registry, package: packageName, version};
  const cached = await getRegistryVersion(key);
  if (cached) {
    // Removing a trusted key must take effect without a cache reset.
    const document = await verifyCachedEnvelope({
      settings,
      package: packageName,
      version,
      envelope: cached.envelope,
      kind: kind ?? cached.kind,
    });
    if (document) {
      registryCacheHit.add(1, {kind: kind ?? 'any'});
      return {...cached, document};
    }
    await deleteRegistryVersion(key);
  }

  const fetched = await fetchVersion(params);
  await insertRegistryVersion(fetched);
  return fetched;
}

export async function getSource(params: VersionRequest): Promise<Uint8Array> {
  const version = await resolveVersion(params);
  if (version.source) return version.source;

  const {digest} = version.document.source;
  const source = await fetchBlob({...params, digest});
  await assertBundleDigest({...params, bytes: source, digest});
  await setRegistryVersionSource({
    registry: params.settings.registry,
    package: params.package,
    version: params.version,
    source,
  });
  return source;
}

export async function getReadme(params: VersionRequest): Promise<string | undefined> {
  const version = await resolveVersion(params);
  if (!version.document.readme) return undefined;
  if (version.readme !== null) return version.readme;

  const {digest} = version.document.readme;
  const bytes = await fetchBlob({...params, digest});
  if (sha256Digest(bytes) !== digest) {
    throw new RegistrySignatureInvalidError({
      package: params.package,
      version: params.version,
      reason: 'digest-mismatch',
    });
  }
  const readme = new TextDecoder().decode(bytes);
  await setRegistryVersionReadme({
    registry: params.settings.registry,
    package: params.package,
    version: params.version,
    readme,
  });
  return readme;
}

async function verifyCachedEnvelope(
  params: VersionRequest & {envelope: unknown; kind: RegistryPackageKind},
): Promise<RegistryVersionDocument | undefined> {
  try {
    return await verifyEnvelope(params);
  } catch (error) {
    if (!isVerificationError(error)) throw error;
    logger().warn(
      {package: params.package, version: params.version},
      'Cached registry version no longer verifies, fetching it again',
    );
    return undefined;
  }
}

async function fetchVersion(
  params: VersionRequest & {kind?: RegistryPackageKind | undefined},
): Promise<RegistryVersion> {
  const metricKind = params.kind ?? 'any';
  try {
    const version = await fetchAndVerifyVersion(params);
    registryFetch.add(1, {kind: metricKind, result: 'ok'});
    return version;
  } catch (error) {
    const result = fetchResult(error);
    if (result) registryFetch.add(1, {kind: metricKind, result});
    if (error instanceof RegistrySignatureInvalidError) {
      logger().warn(
        {package: params.package, version: params.version, reason: error.reason},
        'Registry version failed verification',
      );
    }
    throw error;
  }
}

async function fetchAndVerifyVersion(
  params: VersionRequest & {kind?: RegistryPackageKind | undefined},
): Promise<RegistryVersion> {
  const {settings, package: packageName, version} = params;
  const envelopeBytes = await fetchRegistryFile({
    registry: settings.registry,
    path: registryVersionPath({package: packageName, version}),
  });
  if (!envelopeBytes) throw new RegistryVersionNotFoundError({package: packageName, version});

  const envelope = parseJson(envelopeBytes);
  const document = await verifyEnvelope({...params, envelope});
  const {digest} = document.content;
  const content = await fetchBlob({...params, digest});
  await assertBundleDigest({...params, bytes: content, digest});

  return {
    registry: settings.registry,
    package: packageName,
    version,
    kind: document.kind,
    digest,
    envelope: registryEnvelopeSchema.parse(envelope),
    document,
    content,
    source: null,
    readme: null,
    fetchedAt: new Date(),
  };
}

async function verifyEnvelope(
  params: VersionRequest & {envelope: unknown; kind?: RegistryPackageKind | undefined},
): Promise<RegistryVersionDocument> {
  const kinds = params.kind ? [params.kind] : REGISTRY_PACKAGE_KINDS;
  let failure: RegistryEnvelopeError | undefined;
  for (const kind of kinds) {
    try {
      const {document} = await verifyRegistryVersionEnvelope({
        envelope: params.envelope,
        trustedKeys: params.settings.trustedKeys,
        expected: {package: params.package, version: params.version, kind},
      });
      return document;
    } catch (error) {
      if (!(error instanceof RegistryEnvelopeError)) throw error;
      failure = error;
      // Only a different kind can fix a kind mismatch.
      if (error.reason !== 'payload-mismatch') break;
    }
  }
  if (failure?.reason === 'schema-unsupported') {
    throw new RegistrySchemaUnsupportedError({package: params.package, version: params.version});
  }
  throw new RegistrySignatureInvalidError({
    package: params.package,
    version: params.version,
    reason:
      failure?.reason === 'malformed' || failure?.reason === 'payload-mismatch'
        ? failure.reason
        : 'signature-invalid',
  });
}

async function fetchBlob(params: VersionRequest & {digest: string}): Promise<Uint8Array> {
  const bytes = await fetchRegistryFile({
    registry: params.settings.registry,
    path: registryBlobPath(params.digest),
  });
  if (!bytes) {
    throw new RegistryUnavailableError(
      `The registry has no file ${params.digest} for ${params.package}@${params.version}`,
    );
  }
  return bytes;
}

async function assertBundleDigest(
  params: VersionRequest & {bytes: Uint8Array; digest: string},
): Promise<void> {
  try {
    await decodeActionBundle({gzip: params.bytes, digest: params.digest});
  } catch (error) {
    if (error instanceof InvalidActionBundleError) {
      throw new RegistrySignatureInvalidError({
        package: params.package,
        version: params.version,
        reason: 'digest-mismatch',
      });
    }
    throw error;
  }
}

function sha256Digest(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
}

function isVerificationError(error: unknown): boolean {
  return (
    error instanceof RegistrySignatureInvalidError ||
    error instanceof RegistrySchemaUnsupportedError
  );
}

function fetchResult(error: unknown): RegistryFetchResult | undefined {
  if (error instanceof RegistryVersionNotFoundError) return 'not-found';
  if (error instanceof RegistryUnavailableError) return 'unavailable';
  if (error instanceof RegistrySignatureInvalidError) return 'signature-invalid';
  if (error instanceof RegistrySchemaUnsupportedError) return 'schema-unsupported';
  return undefined;
}
