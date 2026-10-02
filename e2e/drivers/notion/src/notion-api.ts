import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {type ListeningFake, listenFake, type RecordedWrite} from '@shipfox/e2e-core';

export const NOTION_PAGE_RESULT_MARKER = 'notion-page-result-marker';

const NOTION_PAGE_PATH_RE = /^\/v1\/pages\/([^/]+)$/;
const MAX_ERROR_MESSAGE_LENGTH = 1_000;

export type NotionApiMockCall = {
  kind: 'get_page';
  authorization: string | undefined;
  pageId: string;
};

export interface NotionApiMock {
  calls: NotionApiMockCall[];
  endpoint: URL;
  /** Writes the fake accepted. The fake serves reads only, so this stays empty. */
  writes(): RecordedWrite[];
  stop(): Promise<void>;
}

export interface NotionApiMockOptions {
  /**
   * The access token the API presents, from the connection the spec creates. The fake shares the
   * stack's Notion address with other specs and answers the requests that carry this token.
   */
  accessToken?: string | undefined;
  /** Listens here directly instead of behind the stack's router. Unit tests pass port 0. */
  endpoint?: URL | undefined;
}

export async function startNotionApiMock(
  options: NotionApiMockOptions = {},
): Promise<NotionApiMock> {
  const configuredEndpoint = options.endpoint ?? new URL(requiredNotionApiBaseUrl());
  validateEndpoint(configuredEndpoint);
  const calls: NotionApiMockCall[] = [];
  let boundEndpoint = configuredEndpoint;
  const server = createServer((request, response) => {
    try {
      handleNotionRequest({calls, endpoint: boundEndpoint, request, response});
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      process.stderr.write(
        `Notion API mock request failed: ${message.slice(0, MAX_ERROR_MESSAGE_LENGTH)}\n`,
      );
      if (response.destroyed || response.writableEnded) return;
      if (!response.headersSent)
        sendJson(response, 400, {code: 'E2E_BAD_REQUEST', message: 'Invalid Notion request'});
      else response.end();
    }
  });

  let listening: ListeningFake;
  try {
    listening = await listenFake({
      server,
      endpoint: options.endpoint,
      stackEndpoint: () => configuredEndpoint,
      credentials: [options.accessToken],
    });
  } catch (error) {
    throw new Error(`Notion API mock failed to start at ${configuredEndpoint}`, {cause: error});
  }
  boundEndpoint = listening.endpoint;

  return {
    calls,
    endpoint: boundEndpoint,
    writes: () => [],
    stop: async () => {
      try {
        await listening.close();
      } catch (error) {
        throw new Error(`Notion API mock failed to stop at ${boundEndpoint}`, {cause: error});
      }
    },
  };
}

function handleNotionRequest(params: {
  calls: NotionApiMockCall[];
  endpoint: URL;
  request: IncomingMessage;
  response: ServerResponse;
}): void {
  const requestUrl = new URL(params.request.url ?? '/', params.endpoint);
  const match = requestUrl.pathname.match(NOTION_PAGE_PATH_RE);
  if (!match) {
    sendJson(params.response, 404, {code: 'E2E_NOT_FOUND', message: 'Unknown Notion endpoint'});
    return;
  }

  if (params.request.method !== 'GET') {
    sendJson(params.response, 405, {
      code: 'E2E_METHOD_NOT_ALLOWED',
      message: 'Method not allowed',
    });
    return;
  }

  const pageId = decodeURIComponent(match[1] ?? '');
  params.calls.push({
    kind: 'get_page',
    authorization: params.request.headers.authorization,
    pageId,
  });
  sendJson(params.response, 200, {
    id: pageId,
    url: `https://www.notion.so/${pageId.replaceAll('-', '')}`,
    title: 'E2E Notion page',
    parent: {type: 'data_source_id', data_source_id: 'e2e-data-source'},
    properties: {
      Name: {
        id: 'title',
        type: 'title',
        title: [{plain_text: 'E2E Notion page'}],
      },
    },
    created_time: '2026-01-01T00:00:00.000Z',
    last_edited_time: '2026-01-02T00:00:00.000Z',
    marker: NOTION_PAGE_RESULT_MARKER,
  });
}

function requiredNotionApiBaseUrl(): string {
  const endpoint = process.env.NOTION_API_BASE_URL;
  if (!endpoint) throw new Error('NOTION_API_BASE_URL must be configured for the Notion API mock.');
  return endpoint;
}

function validateEndpoint(endpoint: URL): void {
  if (endpoint.port === '') {
    throw new Error(
      `NOTION_API_BASE_URL must include an explicit port for the Notion API mock (received ${endpoint}). Use :0 for an ephemeral test endpoint.`,
    );
  }
  if (endpoint.pathname !== '/') {
    throw new Error(
      `NOTION_API_BASE_URL must not include a path for the Notion API mock (received ${endpoint}).`,
    );
  }
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {'content-type': 'application/json'}).end(JSON.stringify(body));
}
