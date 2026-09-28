import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {type CryptoKey, exportJWK, generateKeyPair, SignJWT} from 'jose';

export const REGISTRY_PUBLIC_URL = 'https://registry.example.com';
const KEY_ID = 'fake-issuer-key';

/** The claims of a GitHub Actions token from the `shipfox` publisher of `BOOTSTRAP_YAML`. */
export function githubClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    repository: 'ShipfoxHQ/shipfox',
    repository_id: '812345678',
    repository_owner_id: '1234567',
    workflow_ref: 'ShipfoxHQ/shipfox/.github/workflows/publish-packages.yml@refs/pull/2210/merge',
    ref: 'refs/pull/2210/merge',
    sha: '3066dabaa0000000000000000000000000000000',
    run_id: '17000000001',
    run_attempt: '1',
    runner_environment: 'github-hosted',
    ...overrides,
  };
}

export interface SignOidcTokenParams {
  claims?: Record<string, unknown>;
  audience?: string;
  issuer?: string;
  /** Seconds since the epoch. */
  issuedAt?: number;
  expiresAt?: number;
  alg?: string;
  kid?: string;
  privateKey?: CryptoKey | Uint8Array;
}

/** An OIDC issuer with its own key set, served over HTTP like GitHub's `.well-known/jwks`. */
export async function createFakeOidcIssuer() {
  const {publicKey, privateKey} = await generateKeyPair('RS256');
  const jwks = {keys: [{...(await exportJWK(publicKey)), kid: KEY_ID, alg: 'RS256', use: 'sig'}]};
  let jwksRequests = 0;
  const server = createServer((request, response) => {
    if (request.url !== '/.well-known/jwks') {
      response.writeHead(404).end();
      return;
    }
    jwksRequests++;
    response.writeHead(200, {'content-type': 'application/json'}).end(JSON.stringify(jwks));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    issuer,
    jwksUrl: new URL(`${issuer}/.well-known/jwks`),
    get jwksRequests() {
      return jwksRequests;
    },
    sign({
      claims = githubClaims(),
      audience = REGISTRY_PUBLIC_URL,
      issuer: iss = issuer,
      issuedAt = Math.floor(Date.now() / 1000),
      expiresAt = issuedAt + 300,
      alg = 'RS256',
      kid = KEY_ID,
      privateKey: key = privateKey,
    }: SignOidcTokenParams = {}): Promise<string> {
      return new SignJWT({jti: randomUUID(), ...claims})
        .setProtectedHeader({alg, kid})
        .setIssuer(iss)
        .setAudience(audience)
        .setIssuedAt(issuedAt)
        .setExpirationTime(expiresAt)
        .sign(key);
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
