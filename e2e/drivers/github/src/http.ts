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
