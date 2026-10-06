import type {ServerResponse} from 'node:http';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function readJsonBody(
  request: NodeJS.ReadableStream,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks).toString('utf8');
  return body === '' ? {} : (JSON.parse(body) as Record<string, unknown>);
}

/** Reads the JSON body, or answers 400 and returns undefined when it does not parse. */
export async function readJsonBodyOrReject(
  request: NodeJS.ReadableStream,
  response: ServerResponse,
): Promise<Record<string, unknown> | undefined> {
  try {
    return await readJsonBody(request);
  } catch {
    sendJson(response, 400, {message: 'Invalid JSON body'});
    return undefined;
  }
}

export function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {'content-type': 'application/json'}).end(JSON.stringify(body));
}

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;

/** One page of a list, chosen by the `per_page` and `page` query parameters, as GitHub does. */
export function paginate<T>(items: T[], searchParams: URLSearchParams): T[] {
  const perPage = Math.min(
    MAX_PAGE_SIZE,
    positiveInteger(searchParams.get('per_page')) ?? DEFAULT_PAGE_SIZE,
  );
  const page = positiveInteger(searchParams.get('page')) ?? 1;
  return items.slice((page - 1) * perPage, page * perPage);
}

function positiveInteger(value: string | null): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
