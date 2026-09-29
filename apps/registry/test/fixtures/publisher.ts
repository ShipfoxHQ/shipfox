import {Buffer} from 'node:buffer';
import {createApp, type FastifyInstance} from '@shipfox/node-fastify';
import type {RegistryEnvelope} from '@shipfox/registry-format';
import {createBlobStore} from '#blobs.js';
import {loadBootstrap} from '#bootstrap.js';
import {GITHUB_OIDC_ISSUER, type GithubOidcClaims} from '#publish/oidc.js';
import {createPublishTokenVerifier, mintPublishToken} from '#publish/publish-token.js';
import {createVersionPublisher} from '#publish/publish-version.js';
import {versionRoutes} from '#publish/version-routes.js';
import {type RegistrySigningKey, registrySigner} from '#signing-key.js';
import type {RegistryStorage} from '#storage/storage.js';
import {githubClaims, REGISTRY_PUBLIC_URL} from '#test/fixtures/fake-oidc-issuer.js';
import {multipartRequest, type PublishFixture} from '#test/fixtures/packages.js';

export const PUBLISHER = {
  provider: 'github',
  repository_id: '812345678',
  repository_owner_id: '1234567',
  repository: 'ShipfoxHQ/shipfox',
  workflow: '.github/workflows/publish-packages.yml',
  runner_environment: 'github-hosted',
} as const;

/** A publish token minted the way the token exchange mints it. */
export async function publishTokenFor({
  signingKey,
  namespace = 'shipfox',
}: {
  signingKey: RegistrySigningKey;
  namespace?: string;
}): Promise<string> {
  const claims = {
    iss: GITHUB_OIDC_ISSUER,
    jti: 'oidc-token',
    exp: Math.floor(Date.now() / 1000) + 300,
    ...githubClaims(),
  } as GithubOidcClaims;
  const {token} = await mintPublishToken({
    signingKey,
    publicUrl: REGISTRY_PUBLIC_URL,
    namespace,
    publisher: PUBLISHER,
    claims,
  });
  return token;
}

export interface PublishResponse {
  statusCode: number;
  json<T = unknown>(): T;
}

export interface PublishApp {
  app: FastifyInstance;
  /** Publishes as the `shipfox` namespace unless `token` or `namespace` says otherwise. */
  publish(
    params: PublishFixture & {
      namespace?: string;
      name?: string;
      version?: string;
      token?: string | null;
    },
  ): Promise<PublishResponse>;
}

export async function startPublishApp({
  signingKey,
  storage,
  bootstrapPath,
  hooks = [],
}: {
  signingKey: RegistrySigningKey;
  storage: RegistryStorage;
  bootstrapPath: string;
  hooks?: string[];
}): Promise<PublishApp> {
  const publishVersion = createVersionPublisher({
    bootstrap: await loadBootstrap(bootstrapPath),
    signer: registrySigner(signingKey),
    verifyToken: createPublishTokenVerifier({signingKey, publicUrl: REGISTRY_PUBLIC_URL}),
    blobs: createBlobStore(storage),
    hooks,
  });
  const app = await createApp({routes: [versionRoutes({publishVersion})], swagger: false});
  return {
    app,
    async publish({
      namespace = 'shipfox',
      name = 'slack-thread-digest',
      version = '1.0.0',
      token,
      ...fixture
    }) {
      const {payload, contentType} = await multipartRequest(fixture);
      const bearer = token === undefined ? await publishTokenFor({signingKey, namespace}) : token;
      return app.inject({
        method: 'PUT',
        url: `/v1/packages/${namespace}/${name}/versions/${version}`,
        headers: {
          'content-type': contentType,
          ...(bearer === null ? {} : {authorization: `Bearer ${bearer}`}),
        },
        payload,
      });
    },
  };
}

export function envelopeOf(response: PublishResponse): RegistryEnvelope {
  return response.json<RegistryEnvelope>();
}

export function documentOf(envelope: RegistryEnvelope): Record<string, unknown> {
  return JSON.parse(Buffer.from(envelope.payload, 'base64').toString('utf8'));
}
