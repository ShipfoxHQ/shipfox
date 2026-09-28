import {createPublicKey} from 'node:crypto';
import {closeApp, createApp, type FastifyInstance} from '@shipfox/node-fastify';
import {decodeJwt, decodeProtectedHeader, generateKeyPair, jwtVerify} from 'jose';
import {loadBootstrap} from '#bootstrap.js';
import {db} from '#db/db.js';
import {audit} from '#db/schema/audit.js';
import {usedTokens} from '#db/schema/used-tokens.js';
import {createPublishTokenExchange} from '#publish/exchange.js';
import {CLOCK_SKEW_SECONDS, createGithubOidcVerifier} from '#publish/oidc.js';
import {PUBLISH_TOKEN_AUDIENCE, type PublishTokenClaims} from '#publish/publish-token.js';
import {publishRoutes} from '#publish/routes.js';
import {
  createFakeOidcIssuer,
  githubClaims,
  REGISTRY_PUBLIC_URL,
  type SignOidcTokenParams,
} from '#test/fixtures/fake-oidc-issuer.js';
import {createTemporaryRegistry, resetRegistryDatabase} from '#test/fixtures/registry.js';
import {testSigningKey} from '#test/fixtures/signing-key.js';

const BOOTSTRAP = `
namespaces:
  shipfox:
    profile: {display_name: Shipfox}
    publishers:
      - provider: github
        repository_id: "812345678"
        repository_owner_id: "1234567"
        repository: ShipfoxHQ/shipfox
        workflow: .github/workflows/publish-packages.yml
  guarded:
    profile: {display_name: Guarded}
    publishers:
      - provider: github
        repository_id: "222"
        repository_owner_id: "333"
        repository: acme/guarded
        workflow: .github/workflows/release.yml
        environment: registry
        ref: [refs/heads/main, refs/tags/v*]
        runner_environment: self-hosted
  retired:
    status: suspended
    profile: {display_name: Retired}
    publishers:
      - provider: github
        repository_id: "444"
        repository_owner_id: "555"
        repository: acme/retired
        workflow: .github/workflows/release.yml
`;

const guardedClaims = (overrides: Record<string, unknown> = {}) =>
  githubClaims({
    repository: 'acme/guarded',
    repository_id: '222',
    repository_owner_id: '333',
    workflow_ref: 'acme/guarded/.github/workflows/release.yml@refs/heads/main',
    ref: 'refs/heads/main',
    environment: 'registry',
    runner_environment: 'self-hosted',
    ...overrides,
  });

describe('POST /v1/publish/token', () => {
  const signingKey = testSigningKey();
  let issuer: Awaited<ReturnType<typeof createFakeOidcIssuer>>;
  let registry: Awaited<ReturnType<typeof createTemporaryRegistry>>;
  let app: FastifyInstance;

  beforeAll(async () => {
    issuer = await createFakeOidcIssuer();
  });

  afterAll(async () => {
    await issuer.close();
  });

  async function startApp(jwksUrl = issuer.jwksUrl) {
    const exchange = createPublishTokenExchange({
      bootstrap: await loadBootstrap(await registry.writeBootstrap(BOOTSTRAP)),
      signingKey,
      publicUrl: REGISTRY_PUBLIC_URL,
      verifyOidcToken: createGithubOidcVerifier({
        audience: REGISTRY_PUBLIC_URL,
        issuer: issuer.issuer,
        jwksUrl,
      }),
    });
    app = await createApp({routes: publishRoutes({exchange}), swagger: false});
  }

  beforeEach(async () => {
    registry = await createTemporaryRegistry();
    await resetRegistryDatabase();
    await startApp();
  });

  afterEach(async () => {
    await closeApp();
    await registry.cleanup();
  });

  const exchange = (oidcToken: string) =>
    app.inject({method: 'POST', url: '/v1/publish/token', payload: {oidc_token: oidcToken}});

  const signAndExchange = async (params: SignOidcTokenParams) =>
    exchange(await issuer.sign(params));

  async function auditRecords() {
    const rows = await db().select().from(audit).orderBy(audit.at);
    return rows.map(({event, reason, namespace, detail}) => ({
      record: {
        event,
        reason,
        namespace,
        ...(detail as {grants?: unknown[]; oidc?: Record<string, unknown>}),
      },
    }));
  }

  function tokenRows() {
    return db().select().from(usedTokens);
  }

  async function onlyAuditRecord() {
    const records = await auditRecords();
    expect(records).toHaveLength(1);
    return records[0] as (typeof records)[number];
  }

  describe('on success', () => {
    it('returns a publish token for one namespace with the run provenance', async () => {
      const oidcToken = await issuer.sign();

      const response = await exchange(oidcToken);

      expect(response.statusCode).toBe(200);
      const {publish_token: publishToken, expires_at: expiresAt} = response.json();
      expect(decodeProtectedHeader(publishToken)).toEqual({alg: 'EdDSA', kid: 'test-key'});
      const {payload} = await jwtVerify(publishToken, createPublicKey(signingKey.privateKey), {
        issuer: REGISTRY_PUBLIC_URL,
        audience: PUBLISH_TOKEN_AUDIENCE,
        algorithms: ['EdDSA'],
      });
      expect(payload).toMatchObject({
        namespace: 'shipfox',
        grant: {
          provider: 'github',
          repository_id: '812345678',
          repository_owner_id: '1234567',
          workflow: '.github/workflows/publish-packages.yml',
        },
        provenance: {
          issuer: issuer.issuer,
          repository: 'ShipfoxHQ/shipfox',
          repository_id: '812345678',
          repository_owner_id: '1234567',
          commit: '3066dabaa0000000000000000000000000000000',
          ref: 'refs/pull/2210/merge',
          workflow_ref:
            'ShipfoxHQ/shipfox/.github/workflows/publish-packages.yml@refs/pull/2210/merge',
          run_id: '17000000001',
          run_attempt: '1',
        },
      } satisfies Partial<PublishTokenClaims>);
      expect(payload.exp).toBe((payload.iat as number) + 600);
      expect(expiresAt).toBe(new Date((payload.exp as number) * 1000).toISOString());
      expect(await auditRecords()).toEqual([]);
    });

    it('matches the grant that lists a ref pattern, an environment, and self-hosted runners', async () => {
      const response = await signAndExchange({
        claims: guardedClaims({ref: 'refs/tags/v1.2.3'}),
      });

      expect(response.statusCode).toBe(200);
      expect(decodeJwt(response.json().publish_token)).toMatchObject({namespace: 'guarded'});
    });

    it('fetches the issuer key set once across exchanges', async () => {
      const before = issuer.jwksRequests;

      await signAndExchange({});
      await signAndExchange({});

      expect(issuer.jwksRequests - before).toBe(1);
    });
  });

  describe('single use', () => {
    it('refuses a token that was already exchanged, and audits it', async () => {
      const oidcToken = await issuer.sign();
      await exchange(oidcToken);

      const response = await exchange(oidcToken);

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({code: 'oidc-token-replayed'});
      expect(await auditRecords()).toMatchObject([
        {
          record: {
            event: 'publish-token-refused',
            reason: 'oidc-token-replayed',
            namespace: 'shipfox',
          },
        },
      ]);
    });

    it('lets exactly one of two concurrent exchanges through', async () => {
      const oidcToken = await issuer.sign();

      const responses = await Promise.all([exchange(oidcToken), exchange(oidcToken)]);

      expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 401]);
    });

    it('records the token id until the token can no longer verify', async () => {
      const oidcToken = await issuer.sign();
      const {jti, exp} = decodeJwt(oidcToken);

      await exchange(oidcToken);

      const rows = await tokenRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.jti).toBe(jti);
      expect(rows[0]?.expiresAt).toEqual(new Date(((exp as number) + CLOCK_SKEW_SECONDS) * 1000));
    });
  });

  describe('OIDC token verification', () => {
    const now = () => Math.floor(Date.now() / 1000);

    it.each([
      ['another issuer', () => ({issuer: 'https://evil.example.com'})],
      ['another audience', () => ({audience: 'https://other-registry.example.com'})],
      ['an expired token', () => ({issuedAt: now() - 3600, expiresAt: now() - 1800})],
      [
        'an issued-at time in the future',
        () => ({issuedAt: now() + 3600, expiresAt: now() + 7200}),
      ],
      [
        'a token older than its maximum age',
        () => ({issuedAt: now() - 3600, expiresAt: now() + 3600}),
      ],
      [
        'an algorithm outside the allowlist',
        () => ({alg: 'HS256', privateKey: new TextEncoder().encode('k'.repeat(32))}),
      ],
      ['an unknown signing key id', () => ({kid: 'not-in-the-key-set'})],
      ['a missing token id', () => ({claims: githubClaims({jti: undefined})})],
      ['an unusable token id', () => ({claims: githubClaims({jti: '../../v1/index.json'})})],
      ['a missing repository id', () => ({claims: githubClaims({repository_id: undefined})})],
      [
        'a missing runner environment',
        () => ({claims: githubClaims({runner_environment: undefined})}),
      ],
    ] as const)('refuses %s', async (_case, params) => {
      const response = await signAndExchange(params());

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({code: 'invalid-oidc-token'});
      expect(await auditRecords()).toEqual([]);
      expect(await tokenRows()).toEqual([]);
    });

    it('refuses a token signed by a key outside the issuer key set', async () => {
      const {privateKey} = await generateKeyPair('RS256');

      const response = await signAndExchange({privateKey});

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({code: 'invalid-oidc-token'});
    });

    it.each(['not-a-jwt', 'e30.e30.'])('refuses the malformed token %s', async (oidcToken) => {
      const response = await exchange(oidcToken);

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({code: 'invalid-oidc-token'});
    });

    it('accepts an issued-at time within the clock skew', async () => {
      const response = await signAndExchange({issuedAt: now() + 30, expiresAt: now() + 330});

      expect(response.statusCode).toBe(200);
    });

    it('fails with a server error, not a refusal, when the key set cannot be fetched', async () => {
      await closeApp();
      const unreachable = await createFakeOidcIssuer();
      const oidcToken = await unreachable.sign({issuer: issuer.issuer});
      const jwksUrl = unreachable.jwksUrl;
      await unreachable.close();
      await startApp(jwksUrl);

      const response = await exchange(oidcToken);

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({code: 'server-error'});
    });

    it('rejects a request without an OIDC token', async () => {
      const response = await app.inject({method: 'POST', url: '/v1/publish/token', payload: {}});

      expect(response.statusCode).toBe(400);
    });
  });

  describe('grant matching', () => {
    it.each([
      ['repository_id', 'shipfox', {repository_id: '999'}],
      ['repository_owner_id', 'shipfox', {repository_owner_id: '999'}],
      [
        'workflow_ref',
        'shipfox',
        {workflow_ref: 'ShipfoxHQ/shipfox/.github/workflows/other.yml@refs/heads/main'},
      ],
      [
        'workflow_ref',
        'shipfox',
        {workflow_ref: 'ShipfoxHQ/other/.github/workflows/publish-packages.yml@refs/heads/main'},
      ],
      ['runner_environment', 'shipfox', {runner_environment: 'self-hosted'}],
      ['ref', 'guarded', {ref: 'refs/heads/feature'}],
      ['ref', 'guarded', {ref: 'refs/tags/v1/2'}],
      ['environment', 'guarded', {environment: 'staging'}],
      ['environment', 'guarded', {environment: undefined}],
      ['runner_environment', 'guarded', {runner_environment: 'github-hosted'}],
    ] as const)('refuses a token whose %s does not match the %s grant', async (field, grant, overrides) => {
      const claims = grant === 'guarded' ? guardedClaims(overrides) : githubClaims(overrides);

      const response = await signAndExchange({claims});

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({code: 'publish-grant-not-found'});
      const {record} = await onlyAuditRecord();
      expect(record).toMatchObject({
        event: 'publish-token-refused',
        reason: 'publish-grant-not-found',
        oidc: {run_id: '17000000001'},
      });
      expect(record.grants).toContainEqual({namespace: grant, fields: [field]});
      expect(await tokenRows()).toEqual([]);
    });

    it('refuses an identity that no grant names, listing every grant it missed', async () => {
      const response = await signAndExchange({
        claims: githubClaims({repository_id: '1', repository_owner_id: '2'}),
      });

      expect(response.statusCode).toBe(403);
      const {record} = await onlyAuditRecord();
      expect(record.grants).toEqual([
        {namespace: 'shipfox', fields: ['repository_id', 'repository_owner_id']},
        {
          namespace: 'guarded',
          fields: [
            'repository_id',
            'repository_owner_id',
            'workflow_ref',
            'ref',
            'environment',
            'runner_environment',
          ],
        },
        {
          namespace: 'retired',
          fields: ['repository_id', 'repository_owner_id', 'workflow_ref'],
        },
      ]);
    });

    it('refuses a publisher of a suspended namespace, and audits it', async () => {
      const response = await signAndExchange({
        claims: githubClaims({
          repository: 'acme/retired',
          repository_id: '444',
          repository_owner_id: '555',
          workflow_ref: 'acme/retired/.github/workflows/release.yml@refs/heads/main',
          ref: 'refs/heads/main',
        }),
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({code: 'namespace-suspended'});
      expect(await auditRecords()).toMatchObject([
        {record: {reason: 'namespace-suspended', namespace: 'retired'}},
      ]);
      expect(await tokenRows()).toEqual([]);
    });
  });
});
