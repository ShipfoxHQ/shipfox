import {
  REGISTRY_CATALOG_PATH,
  REGISTRY_VERSION_PAYLOAD_TYPE,
  type RegistryCatalogEntry,
  type RegistryVersionDocument,
  registryCatalogSchema,
  registryPackageIndexPath,
  registryPackageIndexSchema,
  registryVersionDocumentSchema,
  registryVersionPath,
} from '@shipfox/registry-format';
import {z} from 'zod';
import type {RegistryBootstrap} from '#bootstrap.js';
import {buildCatalogEntry, buildPackageIndex, curateCatalog, replaceJsonFile} from '#indexes.js';
import type {RegistryStorage} from '#storage/storage.js';

const VERSION_KEY_PATTERN = /^v1\/packages\/[^/]+\/[^/]+\/versions\/[^/]+\.json$/;

const envelopeSchema = z.object({
  payloadType: z.literal(REGISTRY_VERSION_PAYLOAD_TYPE),
  payload: z.string(),
});

export interface ReindexResult {
  readonly packages: number;
  readonly versions: number;
  /** Version files that could not be read; they are left out of every index. */
  readonly skipped: {key: string; reason: string}[];
}

/**
 * Rebuilds every package index and the catalog from the stored version envelopes. Indexes can lag
 * behind envelopes after a crashed publish; this repairs them all at once.
 */
export async function reindexRegistry({
  storage,
  bootstrap,
}: {
  storage: RegistryStorage;
  bootstrap: RegistryBootstrap;
}): Promise<ReindexResult> {
  const {documentsByPackage, skipped} = await readVersionDocuments(storage);

  const entries: RegistryCatalogEntry[] = [];
  let versions = 0;
  for (const [packageName, documents] of documentsByPackage) {
    await replaceJsonFile({
      storage,
      key: registryPackageIndexPath(packageName),
      value: registryPackageIndexSchema.parse(buildPackageIndex(documents)),
    });
    entries.push(buildCatalogEntry({documents, bootstrap}));
    versions += documents.length;
  }

  await replaceJsonFile({
    storage,
    key: REGISTRY_CATALOG_PATH,
    value: registryCatalogSchema.parse(curateCatalog({catalog: {packages: entries}, bootstrap})),
  });

  return {packages: documentsByPackage.size, versions, skipped};
}

async function readVersionDocuments(storage: RegistryStorage) {
  const documentsByPackage = new Map<string, RegistryVersionDocument[]>();
  const skipped: ReindexResult['skipped'] = [];
  for (const key of await storage.list('v1/packages/')) {
    if (!VERSION_KEY_PATTERN.test(key)) continue;
    const document = await readVersionDocument(storage, key).catch((error: unknown) => {
      skipped.push({key, reason: error instanceof Error ? error.message : String(error)});
      return undefined;
    });
    if (!document) continue;
    if (registryVersionPath(document) !== key) {
      skipped.push({key, reason: `payload names ${document.package}@${document.version}`});
      continue;
    }
    const documents = documentsByPackage.get(document.package) ?? [];
    documentsByPackage.set(document.package, [...documents, document]);
  }
  return {documentsByPackage, skipped};
}

// The registry wrote these envelopes itself, so reindexing reads the payload without verifying it.
async function readVersionDocument(
  storage: RegistryStorage,
  key: string,
): Promise<RegistryVersionDocument | undefined> {
  const stored = await storage.get(key);
  if (!stored) return undefined;
  const envelope = envelopeSchema.parse(JSON.parse(stored.body.toString('utf8')));
  const payload = JSON.parse(Buffer.from(envelope.payload, 'base64').toString('utf8'));
  return registryVersionDocumentSchema.parse(payload);
}
