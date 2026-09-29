import {createHash} from 'node:crypto';
import {
  computeFingerprint,
  formatRegistryPackageName,
  parseRegistryReference,
  REGISTRY_VERSION_DOCUMENT_SCHEMA,
  type RegistryEnvelope,
  type RegistrySigner,
  registryVersionDocumentSchema,
  signRegistryVersionDocument,
} from '@shipfox/registry-format';
import type {BlobStore} from '#blobs.js';
import type {RegistryBootstrap} from '#bootstrap.js';
import {
  recordVersionAttempt,
  VERSION_REFUSED_EVENT,
  VERSION_RETRIED_EVENT,
} from '#publish/audit.js';
import {decodeBundle} from '#publish/bundle.js';
import {publishDraftSchema} from '#publish/draft.js';
import {VersionRefusedError} from '#publish/errors.js';
import {callPublishHooks} from '#publish/hooks.js';
import {describeIssues} from '#publish/issues.js';
import {
  ACTION_CONTENT_LIMIT_BYTES,
  SOURCE_LIMIT_BYTES,
  TEMPLATE_CONTENT_LIMIT_BYTES,
} from '#publish/limits.js';
import {checkMetadata, readmeText} from '#publish/metadata-rules.js';
import {
  compareWithPrevious,
  deriveMetadata,
  packageCard,
  preparePackage,
  summaryOf,
} from '#publish/prepared-package.js';
import type {PublishTokenVerifier} from '#publish/publish-token.js';
import {parsePublishRequest} from '#publish/request.js';
import {checkSourceArchive} from '#publish/source-archive.js';
import {
  checkBump,
  checkPackageCoordinates,
  highestLowerVersion,
  isReservedName,
} from '#publish/version-rules.js';
import {
  actionVersionExists,
  changedWithoutBump,
  findPackageKind,
  findStoredVersion,
  listVersionNumbers,
  writeVersion,
} from '#publish/versions.js';

export interface PublishVersionParams {
  /** The bearer token of the request, when it sent one. */
  token: string | undefined;
  namespace: string;
  name: string;
  version: string;
  body: Buffer;
  contentType: string | undefined;
}

export interface PublishVersionResult {
  envelope: RegistryEnvelope;
  /** False when the version was already published with the same content. */
  created: boolean;
}

export type VersionPublisher = (params: PublishVersionParams) => Promise<PublishVersionResult>;

type PublishClaims = Awaited<ReturnType<PublishTokenVerifier>>;

/**
 * Publishes one package version: checks the request against the rules of the registry, derives
 * the version document, signs it, and stores it. The bundles go to the blob store first, keyed by
 * their digests, and one transaction then commits the rows. A crash between the two leaves
 * blobs no version row points to, and the same request publishes normally afterwards.
 */
export function createVersionPublisher({
  bootstrap,
  signer,
  verifyToken,
  blobs,
  hooks,
}: {
  bootstrap: RegistryBootstrap;
  signer: RegistrySigner;
  verifyToken: PublishTokenVerifier;
  blobs: BlobStore;
  hooks: readonly string[];
}): VersionPublisher {
  return async (params) => {
    // A request without a valid token is not recorded, so nobody can grow the audit table with it.
    const claims = await verifyToken(params.token);
    const packageName = `${params.namespace}/${params.name}`;
    try {
      const result = await publish({...params, claims});
      await callPublishHooks({hooks, event: result.event});
      if (!result.created) {
        await recordVersionAttempt({
          event: VERSION_RETRIED_EVENT,
          outcome: 'accepted',
          reason: 'retry',
          namespace: params.namespace,
          packageName,
          version: params.version,
          detail: {provenance: claims.provenance},
        });
      }
      return {envelope: result.envelope, created: result.created};
    } catch (error) {
      if (error instanceof VersionRefusedError) {
        await recordVersionAttempt({
          event: VERSION_REFUSED_EVENT,
          outcome: 'refused',
          reason: error.reason,
          namespace: claims.namespace,
          packageName,
          version: params.version,
          detail: {message: error.message, provenance: claims.provenance},
        });
      }
      throw error;
    }
  };

  async function publish({
    claims,
    namespace,
    name,
    version,
    body,
    contentType,
  }: PublishVersionParams & {claims: PublishClaims}) {
    checkTarget({bootstrap, claims, namespace, name, version});
    const packageName = `${namespace}/${name}`;
    const submission = await readSubmission({packageName, name, version, body, contentType});

    const stored = await findStoredVersion({package: packageName, version});
    if (stored) {
      if (stored.fingerprint !== submission.fingerprint) {
        throw changedWithoutBump({package: packageName, version});
      }
      return {created: false, envelope: stored.envelope, event: eventOf(stored.envelope)};
    }
    const change = await checkVersionRules({packageName, version, submission});

    const {draft, content, source, prepared} = submission;
    const derived = deriveMetadata({
      prepared,
      reference: {namespace, name, version},
      contentBytes: content.bytes,
    });
    const publishedAt = new Date();
    // Parsing checks the document and drops what its schema does not know.
    const document = registryVersionDocumentSchema.parse({
      schema: REGISTRY_VERSION_DOCUMENT_SCHEMA,
      package: packageName,
      version,
      visibility: 'public',
      fingerprint: submission.fingerprint,
      published_at: publishedAt.toISOString(),
      license: draft.license,
      source: {digest: source.digest, bytes: source.bytes, format: 'source-archive@1'},
      readme: submission.readmeBlob,
      manifest: prepared.manifest,
      derived,
      actions: prepared.actions,
      changelog: draft.changelog,
      bump: change?.required,
      builder: draft.builder,
      provenance: {...claims.provenance, path: draft.path},
      ...(draft.kind === 'action'
        ? {
            kind: 'action',
            content: {digest: content.digest, bytes: content.bytes, format: 'action-bundle@1'},
            dependencies: draft.dependencies,
          }
        : {
            kind: 'template',
            content: {digest: content.digest, bytes: content.bytes, format: 'template-bundle@1'},
            composition: draft.composition,
          }),
    });
    const envelope = await signRegistryVersionDocument({document, signer});

    await Promise.all([
      blobs.put({digest: content.digest, body: submission.parts.content}),
      blobs.put({digest: source.digest, body: submission.parts.source}),
    ]);
    const write = await writeVersion({
      package: packageName,
      namespace,
      kind: draft.kind,
      version,
      card: packageCard({prepared, derived}),
      envelope,
      document,
      fingerprint: submission.fingerprint,
      contentDigest: content.digest,
      sourceDigest: source.digest,
      readme: submission.readme,
      bump: change?.required,
      capabilityChange: change?.capabilityChange ?? false,
      publishedAt,
      auditDetail: {
        fingerprint: submission.fingerprint,
        bump: change?.required ?? null,
        provenance: document.provenance,
      },
    });
    return {
      created: write.outcome === 'created',
      envelope: write.envelope,
      event: eventOf(write.envelope),
    };
  }
}

/** Refuses a publish that no request content could make valid. */
function checkTarget({
  bootstrap,
  claims,
  namespace,
  name,
  version,
}: {
  bootstrap: RegistryBootstrap;
  claims: PublishClaims;
  namespace: string;
  name: string;
  version: string;
}): void {
  if (claims.namespace !== namespace) {
    throw new VersionRefusedError(
      'namespace-mismatch',
      `The publish token is for namespace ${claims.namespace}, not ${namespace}`,
    );
  }
  if (bootstrap.namespaces[namespace]?.status !== 'active') {
    throw new VersionRefusedError('namespace-suspended', `Namespace ${namespace} is suspended`);
  }
  checkPackageCoordinates({namespace, name, version});
  if (isReservedName({name, reserved: bootstrap.reserved})) {
    throw new VersionRefusedError('reserved-name', `The name ${name} is reserved`);
  }
}

/** Everything the request says about the version, decoded and checked, before any state is read. */
async function readSubmission({
  packageName,
  name,
  version,
  body,
  contentType,
}: {
  packageName: string;
  name: string;
  version: string;
  body: Buffer;
  contentType: string | undefined;
}) {
  const parts = await parsePublishRequest({body, contentType});
  const draft = parseDraft(parts.draft);
  const existingKind = await findPackageKind(packageName);
  if (existingKind !== undefined && existingKind !== draft.kind) {
    throw new VersionRefusedError(
      'kind-mismatch',
      `${packageName} is a ${existingKind}, not a ${draft.kind}`,
    );
  }

  const content = await decodeBundle({
    gzip: parts.content,
    label: 'content bundle',
    limitBytes: draft.kind === 'action' ? ACTION_CONTENT_LIMIT_BYTES : TEMPLATE_CONTENT_LIMIT_BYTES,
  });
  const source = await decodeBundle({
    gzip: parts.source,
    label: 'source archive',
    limitBytes: SOURCE_LIMIT_BYTES,
  });
  checkSourceArchive(source.files);

  const prepared = preparePackage({draft, name, files: content.files});
  checkMetadata({license: draft.license, summary: summaryOf(prepared), readme: parts.readme});
  const readme = parts.readme && readmeText(parts.readme);
  const readmeBlob = parts.readme && {
    digest: sha256Digest(parts.readme),
    bytes: parts.readme.length,
  };

  const fingerprint = await computeFingerprint({
    package: packageName,
    kind: draft.kind,
    version,
    license: draft.license,
    manifest: prepared.manifest,
    changelog: draft.changelog,
    actions: prepared.actions,
    content: {digest: content.digest},
    source: {digest: source.digest},
    readme: readmeBlob,
    dependencies: draft.kind === 'action' ? draft.dependencies : undefined,
    builder: {recipe: draft.builder.recipe},
  });
  return {parts, draft, content, source, prepared, readme, readmeBlob, fingerprint};
}

/** The bump against the highest lower version, and whether a template's actions are published. */
async function checkVersionRules({
  packageName,
  version,
  submission,
}: {
  packageName: string;
  version: string;
  submission: Awaited<ReturnType<typeof readSubmission>>;
}) {
  const {prepared} = submission;
  const previous = await previousVersion({packageName, version});
  const change = previous && compareWithPrevious({prepared, previousManifest: previous.manifest});
  if (previous && change) {
    checkBump({previous: previous.version, next: version, required: change.required});
  }
  await checkActionsExist(prepared.actions);
  return change;
}

function parseDraft(text: string) {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new VersionRefusedError('invalid-draft', 'The draft part is not JSON', {cause: error});
  }
  const draft = publishDraftSchema.safeParse(json);
  if (!draft.success) {
    throw new VersionRefusedError(
      'invalid-draft',
      `The draft is invalid: ${describeIssues(draft.error)}`,
    );
  }
  return draft.data;
}

async function previousVersion({packageName, version}: {packageName: string; version: string}) {
  const previous = highestLowerVersion({version, versions: await listVersionNumbers(packageName)});
  if (previous === undefined) return undefined;
  const stored = await findStoredVersion({package: packageName, version: previous});
  const manifest = (stored?.document as {manifest?: unknown} | undefined)?.manifest;
  return {version: previous, manifest};
}

/** The registry can only vouch for actions it holds, so a template cannot pin one it lacks. */
async function checkActionsExist(actions: readonly string[]): Promise<void> {
  const missing: string[] = [];
  for (const reference of actions) {
    const parsed = parseRegistryReference(reference);
    if (
      !(
        parsed &&
        (await actionVersionExists({
          package: formatRegistryPackageName(parsed),
          version: parsed.version,
        }))
      )
    ) {
      missing.push(reference);
    }
  }
  if (missing.length > 0) {
    throw new VersionRefusedError(
      'action-not-found',
      `The template uses actions the registry does not hold: ${missing.join(', ')}. Publish actions before templates.`,
    );
  }
}

/** What a publish hook is told, read from the envelope this registry signed. */
function eventOf(envelope: RegistryEnvelope) {
  const document = registryVersionDocumentSchema.parse(
    JSON.parse(Buffer.from(envelope.payload, 'base64').toString('utf8')),
  );
  return {
    package: document.package,
    kind: document.kind,
    version: document.version,
    published_at: document.published_at,
  };
}

function sha256Digest(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}
