import {Buffer} from 'node:buffer';
import {config} from './config.js';

const TRAILING_SLASHES_RE = /\/+$/;

export class GiteaInstanceError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(params: {message: string; status: number; details: unknown}) {
    super(params.message);
    this.name = 'GiteaInstanceError';
    this.status = params.status;
    this.details = params.details;
  }
}

export interface GiteaRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  json?: unknown;
}

function baseApiUrl(): string {
  return `${config.E2E_GITEA_URL.replace(TRAILING_SLASHES_RE, '')}/api/v1`;
}

function authHeader(): string {
  const credentials = `${config.E2E_GITEA_ADMIN_USERNAME}:${config.E2E_GITEA_ADMIN_PASSWORD}`;
  return `Basic ${Buffer.from(credentials).toString('base64')}`;
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export async function giteaFetch(
  path: string,
  options: GiteaRequestOptions = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    authorization: authHeader(),
    accept: 'application/json',
  };
  const init: RequestInit = {method: options.method ?? 'GET', headers};
  if (options.json !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(options.json);
  }

  let response: Response;
  try {
    response = await fetch(`${baseApiUrl()}/${path}`, init);
  } catch (error) {
    throw new GiteaInstanceError({
      message: `Gitea request to ${path} failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      status: 0,
      details: error,
    });
  }

  if (!response.ok) {
    throw new GiteaInstanceError({
      message: `Gitea request to ${path} failed with ${response.status}`,
      status: response.status,
      details: await parseBody(response),
    });
  }

  return response;
}

export async function giteaFetchJson<T>(
  path: string,
  options: GiteaRequestOptions = {},
): Promise<T> {
  const response = await giteaFetch(path, options);
  return (await response.json()) as T;
}

export function encodeSegment(segment: string): string {
  return encodeURIComponent(segment);
}
