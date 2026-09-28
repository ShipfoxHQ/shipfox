import {
  REGISTRY_CATALOG_PATH,
  REGISTRY_METADATA_PATH,
  type RegistryMetadata,
  type RegistryNamespaceProfile,
  registryCatalogSchema,
  registryNamespacePath,
} from '@shipfox/registry-format';
import {loadBootstrap, type RegistryBootstrap} from '#bootstrap.js';
import {curateCatalog, JSON_CONTENT_TYPE, jsonBody, updateJsonFile} from '#indexes.js';
import type {RegistrySigningKey} from '#signing-key.js';
import type {RegistryStorage} from '#storage/storage.js';

/**
 * Loads the bootstrap file, then rewrites the files it owns: the registry metadata, namespace
 * profiles, and the catalog's publishers and `featured` order. An invalid file throws before
 * anything is written.
 */
export async function prepareRegistry({
  storage,
  bootstrapPath,
  publicUrl,
  signingKey,
}: {
  storage: RegistryStorage;
  bootstrapPath: string;
  publicUrl: string;
  signingKey: RegistrySigningKey;
}): Promise<RegistryBootstrap> {
  const bootstrap = await loadBootstrap(bootstrapPath);

  const metadata: RegistryMetadata = {publish_url: publicUrl, keys: [signingKey.publicKey]};
  await putJson(storage, REGISTRY_METADATA_PATH, metadata);

  for (const [namespace, {profile}] of Object.entries(bootstrap.namespaces)) {
    const namespaceProfile: RegistryNamespaceProfile = {namespace, ...profile};
    await putJson(storage, registryNamespacePath(namespace), namespaceProfile);
  }

  await updateJsonFile({
    storage,
    key: REGISTRY_CATALOG_PATH,
    schema: registryCatalogSchema,
    update: (catalog) => curateCatalog({catalog: catalog ?? {packages: []}, bootstrap}),
  });

  return bootstrap;
}

async function putJson(storage: RegistryStorage, key: string, value: unknown): Promise<void> {
  await storage.put({key, body: jsonBody(value), contentType: JSON_CONTENT_TYPE});
}
