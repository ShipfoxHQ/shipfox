import {
  type RegistryEnvelope,
  type RegistryPackageIndex,
  type RegistryVersionDocument,
  registryEnvelopeSchema,
  registryPackageIndexSchema,
  registryVersionDocumentSchema,
} from '@shipfox/registry-format';
import {z} from 'zod';
import type {BuiltPackage} from './build.js';

export class RegistryRequestError extends Error {
  readonly status: number;

  constructor({
    method,
    url,
    status,
    body,
  }: {method: string; url: string; status: number; body: string}) {
    super(`${method} ${url} returned ${status}${body === '' ? '' : `: ${body}`}`);
    this.name = 'RegistryRequestError';
    this.status = status;
  }
}

/** What the checks read from the registry. */
export interface RegistryReader {
  getPackageIndex(params: {package: string}): Promise<RegistryPackageIndex | undefined>;
  getVersionDocument(params: {
    package: string;
    version: string;
  }): Promise<RegistryVersionDocument | undefined>;
}

export interface RegistryPublisher {
  exchangeOidcToken(params: {oidcToken: string}): Promise<string>;
  publishVersion(params: {token: string; built: BuiltPackage}): Promise<void>;
}

export type RegistryClient = RegistryReader & RegistryPublisher;

const TRAILING_SLASHES = /\/+$/;

export function trimTrailingSlashes(url: string): string {
  return url.replace(TRAILING_SLASHES, '');
}

const publishTokenSchema = z.object({publish_token: z.string().min(1)});

/**
 * The HTTP client of one registry API. Reads are unauthenticated. The
 * envelope signature is not verified here: this client only compares
 * fingerprints and manifests for CI checks, and it never decides what runs.
 */
export function createRegistryClient({
  url,
  fetch = globalThis.fetch,
}: {
  url: string;
  fetch?: typeof globalThis.fetch | undefined;
}): RegistryClient {
  const base = trimTrailingSlashes(url);

  async function request(method: string, path: string, init: RequestInit = {}) {
    const response = await fetch(`${base}${path}`, {...init, method});
    return response;
  }

  async function assertOk(method: string, path: string, response: Response): Promise<Response> {
    if (response.ok) return response;
    throw new RegistryRequestError({
      method,
      url: `${base}${path}`,
      status: response.status,
      body: (await response.text()).slice(0, 500),
    });
  }

  async function readJson(path: string): Promise<unknown | undefined> {
    const response = await request('GET', path);
    if (response.status === 404) return undefined;
    return (await assertOk('GET', path, response)).json();
  }

  return {
    async getPackageIndex({package: name}) {
      const body = await readJson(packagePath(name));
      return body === undefined ? undefined : registryPackageIndexSchema.parse(body);
    },

    async getVersionDocument({package: name, version}) {
      const body = await readJson(versionPath(name, version));
      return body === undefined
        ? undefined
        : decodeEnvelopePayload(registryEnvelopeSchema.parse(body));
    },

    async exchangeOidcToken({oidcToken}) {
      const path = '/v1/publish/token';
      const response = await request('POST', path, {
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({oidc_token: oidcToken}),
      });
      return publishTokenSchema.parse(await (await assertOk('POST', path, response)).json())
        .publish_token;
    },

    async publishVersion({token, built}) {
      const path = versionPath(built.package, built.version);
      const form = new FormData();
      form.set('draft', new Blob([JSON.stringify(draftOf(built))], {type: 'application/json'}));
      form.set('content', new Blob([built.content.gzip], {type: 'application/gzip'}));
      form.set('source', new Blob([built.source.gzip], {type: 'application/gzip'}));
      if (built.readme) {
        form.set('readme', new Blob([built.readme.text], {type: 'text/markdown'}));
      }
      await assertOk(
        'PUT',
        path,
        await request('PUT', path, {headers: {authorization: `Bearer ${token}`}, body: form}),
      );
    },
  };
}

/** The `draft` part of a publish upload. The registry derives everything else. */
function draftOf(built: BuiltPackage) {
  return {
    kind: built.kind,
    license: built.license,
    changelog: built.changelog,
    builder: built.builder,
    composition: built.composition,
    path: built.path,
  };
}

function decodeEnvelopePayload(envelope: RegistryEnvelope): RegistryVersionDocument {
  const json = Buffer.from(envelope.payload, 'base64').toString('utf8');
  return registryVersionDocumentSchema.parse(JSON.parse(json));
}

function packagePath(name: string): string {
  return `/v1/packages/${name}`;
}

function versionPath(name: string, version: string): string {
  return `${packagePath(name)}/versions/${version}`;
}
