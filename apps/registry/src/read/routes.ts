import {ClientError, defineRoute, type FastifyReply, type RouteExport} from '@shipfox/node-fastify';
import {
  isRegistryVersion,
  parseRegistryPackageName,
  REGISTRY_CATALOG_PATH,
  REGISTRY_METADATA_PATH,
  registryBlobKey,
  registryCatalogSchema,
  registryEnvelopeSchema,
  registryMetadataSchema,
  registryNamespaceProfileSchema,
  registryPackageIndexSchema,
  registryPackageKindSchema,
  registrySlugSchema,
} from '@shipfox/registry-format';
import {z} from 'zod';
import {BLOB_CONTENT_DISPOSITION, BLOB_CONTENT_TYPE} from '#blobs.js';
import type {RegistryBootstrap} from '#bootstrap.js';
import type {RegistrySigningKey} from '#signing-key.js';
import type {RegistryStorage} from '#storage/storage.js';
import {buildCatalog, buildPackageIndex, InvalidCursorError, namespaceProfile} from './catalog.js';
import {withEtag} from './etag.js';
import {
  findPublicPackage,
  findReadableVersion,
  listPublicPackages,
  listVersions,
} from './queries.js';

const SHORT_CACHE = 'public, max-age=60';
const MEDIUM_CACHE = 'public, max-age=300';
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

const packageParams = z.object({namespace: z.string(), name: z.string()});
const versionParams = packageParams.extend({version: z.string()});

export interface ReadRoutesParams {
  bootstrap: RegistryBootstrap;
  signingKey: RegistrySigningKey;
  storage: RegistryStorage;
  publicUrl: string;
  downloadTtlSeconds: number;
}

/**
 * The anonymous read routes. No route takes a digest: every download goes through a package version,
 * so a reader can only reach a blob that a public version names.
 */
export function readRoutes({
  bootstrap,
  signingKey,
  storage,
  publicUrl,
  downloadTtlSeconds,
}: ReadRoutesParams): RouteExport[] {
  const versionOf = async (params: z.infer<typeof versionParams>) => {
    const name = packageNameOf(params);
    if (!isRegistryVersion(params.version)) throw notFound();
    const found = await findReadableVersion({package: name, version: params.version});
    if (found === undefined) throw notFound();
    return found;
  };

  const download = async ({reply, digest}: {reply: FastifyReply; digest: string}) => {
    const key = registryBlobKey(digest);
    reply.header('cache-control', 'no-store');
    const url = await storage.presignGet({key, expiresInSeconds: downloadTtlSeconds});
    if (url !== undefined) return reply.code(307).header('location', url).send();
    const blob = await storage.get(key);
    // A version row names this blob, so its absence is a fault of the store, not a missing route.
    if (blob === null) throw new Error(`The blob store lacks ${key}`);
    return reply
      .type(BLOB_CONTENT_TYPE)
      .header('content-disposition', BLOB_CONTENT_DISPOSITION)
      .send(blob.body);
  };

  return [
    defineRoute({
      method: 'GET',
      path: REGISTRY_METADATA_PATH,
      description: 'The registry public keys and the URL that publishes versions.',
      schema: {response: {200: registryMetadataSchema}},
      handler: (_request, reply) => {
        reply.header('cache-control', MEDIUM_CACHE);
        return {publish_url: publicUrl, keys: [signingKey.publicKey]};
      },
    }),
    defineRoute({
      method: 'GET',
      path: REGISTRY_CATALOG_PATH,
      description: 'The catalog of public packages, the featured ones first.',
      schema: {
        querystring: z.object({
          kind: registryPackageKindSchema.optional(),
          q: z.string().trim().min(1).max(100).optional(),
          cursor: z.string().min(1).max(64).optional(),
        }),
        response: {200: registryCatalogSchema},
      },
      errorHandler: translateCursorError,
      handler: async (request, reply) => {
        const {kind, q, cursor} = request.query;
        const rows = await listPublicPackages({kind, query: q});
        reply.header('cache-control', SHORT_CACHE);
        return withEtag({request, reply, body: buildCatalog({rows, bootstrap, cursor})});
      },
    }),
    defineRoute({
      method: 'GET',
      path: '/v1/namespaces/:namespace',
      description: 'The profile of a namespace.',
      schema: {
        params: z.object({namespace: z.string()}),
        response: {200: registryNamespaceProfileSchema},
      },
      handler: (request, reply) => {
        const {namespace} = request.params;
        const profile = registrySlugSchema.safeParse(namespace).success
          ? namespaceProfile({namespace, bootstrap})
          : undefined;
        if (profile === undefined) throw notFound();
        reply.header('cache-control', MEDIUM_CACHE);
        return profile;
      },
    }),
    defineRoute({
      method: 'GET',
      path: '/v1/packages/:namespace/:name',
      description: 'The kind of a package and every one of its versions.',
      schema: {params: packageParams, response: {200: registryPackageIndexSchema}},
      handler: async (request, reply) => {
        const row = await findPublicPackage(packageNameOf(request.params));
        if (row === undefined) throw notFound();
        const versions = await listVersions(row.name);
        reply.header('cache-control', SHORT_CACHE);
        return withEtag({request, reply, body: buildPackageIndex({row, versions})});
      },
    }),
    defineRoute({
      method: 'GET',
      path: '/v1/packages/:namespace/:name/versions/:version',
      description: 'The signed envelope of a version, as stored.',
      schema: {params: versionParams, response: {200: registryEnvelopeSchema}},
      handler: async (request, reply) => {
        const {envelope} = await versionOf(request.params);
        reply.header('cache-control', IMMUTABLE_CACHE);
        return envelope;
      },
    }),
    defineRoute({
      method: 'GET',
      path: '/v1/packages/:namespace/:name/versions/:version/readme',
      description: 'The README of a version, as Markdown.',
      schema: {params: versionParams},
      handler: async (request, reply) => {
        const {readme} = await versionOf(request.params);
        if (readme === null) throw notFound();
        return reply
          .type('text/markdown; charset=utf-8')
          .header('cache-control', IMMUTABLE_CACHE)
          .send(readme);
      },
    }),
    defineRoute({
      method: 'GET',
      path: '/v1/packages/:namespace/:name/versions/:version/content',
      description: 'Redirects to a short-lived download URL of the content bundle.',
      schema: {params: versionParams},
      handler: async (request, reply) => {
        const {contentDigest} = await versionOf(request.params);
        return download({reply, digest: contentDigest});
      },
    }),
    defineRoute({
      method: 'GET',
      path: '/v1/packages/:namespace/:name/versions/:version/source',
      description: 'Redirects to a short-lived download URL of the source archive.',
      schema: {params: versionParams},
      handler: async (request, reply) => {
        const {sourceDigest} = await versionOf(request.params);
        return download({reply, digest: sourceDigest});
      },
    }),
  ];
}

function packageNameOf({namespace, name}: {namespace: string; name: string}): string {
  const parsed = parseRegistryPackageName(`${namespace}/${name}`);
  if (parsed === undefined) throw notFound();
  return `${parsed.namespace}/${parsed.name}`;
}

function notFound(): ClientError {
  return new ClientError('Not found', 'not-found', {status: 404});
}

function translateCursorError(error: unknown): never {
  if (error instanceof InvalidCursorError) {
    throw new ClientError('The cursor is not one this registry issued.', 'invalid-cursor', {
      status: 400,
      cause: error,
    });
  }
  throw error;
}
