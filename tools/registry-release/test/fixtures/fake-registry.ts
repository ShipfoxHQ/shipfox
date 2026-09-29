import type {RegistryTemplateVersionDocument} from '@shipfox/registry-format';

const VERSION_ROUTE = /^\/v1\/packages\/([^/]+\/[^/]+)\/versions\/([^/]+)$/;
const INDEX_ROUTE = /^\/v1\/packages\/([^/]+\/[^/]+)$/;

export interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * An in-memory registry API. It answers the routes the release tool uses and
 * records every request, so tests assert on what was sent.
 */
export class FakeRegistry {
  readonly requests: RecordedRequest[] = [];
  readonly publishes: {package: string; version: string; parts: Record<string, string>}[] = [];
  private readonly documents = new Map<string, RegistryTemplateVersionDocument>();

  readonly fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body = init?.body;
    this.requests.push({method, path: url.pathname, headers, body});

    if (method === 'POST' && url.pathname === '/v1/publish/token') {
      return Response.json({publish_token: 'publish-token', expires_at: '2026-10-12T09:24:03Z'});
    }
    const version = VERSION_ROUTE.exec(url.pathname);
    if (version?.[1] && version[2]) {
      if (method === 'PUT')
        return await this.publish({package: version[1], version: version[2], body});
      if (method === 'GET') return this.readVersion({package: version[1], version: version[2]});
    }
    const index = INDEX_ROUTE.exec(url.pathname);
    if (method === 'GET' && index?.[1]) return this.readIndex(index[1]);
    return new Response('not found', {status: 404});
  };

  seed(document: RegistryTemplateVersionDocument): void {
    this.documents.set(`${document.package}@${document.version}`, document);
  }

  private readIndex(name: string): Response {
    const versions = [...this.documents.values()].filter(({package: entry}) => entry === name);
    if (versions.length === 0) return new Response('not found', {status: 404});
    return Response.json({
      package: name,
      kind: 'template',
      versions: versions.map((document) => ({
        version: document.version,
        digest: document.content.digest,
        published_at: document.published_at,
        capability_change: false,
      })),
    });
  }

  private readVersion({package: name, version}: {package: string; version: string}): Response {
    const document = this.documents.get(`${name}@${version}`);
    if (document === undefined) return new Response('not found', {status: 404});
    return Response.json({
      payloadType: 'application/vnd.shipfox.registry.version+json',
      payload: Buffer.from(JSON.stringify(document)).toString('base64'),
      signatures: [{keyid: 'test-key', sig: 'c2ln'}],
    });
  }

  private async publish({
    package: name,
    version,
    body,
  }: {
    package: string;
    version: string;
    body: RequestInit['body'];
  }): Promise<Response> {
    const parts: Record<string, string> = {};
    if (body instanceof FormData) {
      for (const [key, value] of body.entries()) {
        parts[key] = typeof value === 'string' ? value : await value.text();
      }
    }
    this.publishes.push({package: name, version, parts});
    return Response.json({});
  }
}
