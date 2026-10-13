import {createHash} from 'node:crypto';
import {CACHE_PART_SIZE_BYTES} from '@shipfox/api-cache-dto';
import {closeApp, createApp, type FastifyInstance} from '@shipfox/node-fastify';
import type {LightMyRequestResponse} from 'fastify';
import {type CacheStoragePolicy, createWorkspaceStorageLimits} from '#core/storage-policy.js';
import {createCacheRoutes} from '#presentation/routes/index.js';
import {fakeLeaseTokenAuthMethod, mintLeaseToken} from './lease-token.js';

export const VERSION = 'a1b2c3d4';

const syncedOrigin: RunOrigin = {origin: 'synced', initiatedByUserId: null};

export interface RunOrigin {
  origin: 'synced' | 'dev';
  initiatedByUserId: string | null;
}

export type TestWorkflows = Parameters<typeof createCacheRoutes>[0];

export interface TestApp {
  app: FastifyInstance;
  /** Answers for `getWorkflowRunOrigin`, keyed by run id. An unknown run is a synced one. */
  origins: Map<string, RunOrigin | null>;
  close(): Promise<void>;
}

export async function createCacheTestApp(
  options: {storagePolicy?: CacheStoragePolicy} = {},
): Promise<TestApp> {
  const origins = new Map<string, RunOrigin | null>();
  const workflows: TestWorkflows = {
    getWorkflowRunOrigin: ({workflowRunId}) =>
      Promise.resolve(
        origins.get(workflowRunId) ?? (origins.has(workflowRunId) ? null : syncedOrigin),
      ),
  };
  const app = await createApp({
    auth: [fakeLeaseTokenAuthMethod],
    routes: createCacheRoutes(workflows, createWorkspaceStorageLimits(options.storagePolicy)),
    swagger: false,
  });
  await app.ready();
  return {app, origins, close: () => closeApp()};
}

export interface TestJob {
  token: string;
  workspaceId: string;
  projectId: string;
  workflowRunId: string;
  jobExecutionId: string;
}

export async function startJob(overrides: Partial<Omit<TestJob, 'token'>> = {}): Promise<TestJob> {
  const job = {
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    workflowRunId: crypto.randomUUID(),
    jobExecutionId: crypto.randomUUID(),
    ...overrides,
  };
  const token = await mintLeaseToken({jobId: crypto.randomUUID(), ...job});
  return {...job, token};
}

/** A second job execution in the same project and workspace as `job`. */
export function startSiblingJob(job: TestJob, overrides: Partial<Omit<TestJob, 'token'>> = {}) {
  return startJob({
    workspaceId: job.workspaceId,
    projectId: job.projectId,
    ...overrides,
  });
}

export function sha256Of(body: Uint8Array): string {
  return createHash('sha256').update(body).digest('hex');
}

export interface ReserveInput {
  scope?: string;
  key: string;
  version?: string;
  body: Uint8Array;
}

type CacheResponse = Promise<LightMyRequestResponse>;

export interface CacheClient {
  restore(body: {
    scope?: string;
    fallback_scopes?: string[];
    key: string;
    restore_keys?: string[];
    version?: string;
  }): CacheResponse;
  reserve(input: ReserveInput): CacheResponse;
  reserveRaw(payload: Record<string, unknown>): CacheResponse;
  commit(entryId: string, parts: {number: number; etag: string}[]): CacheResponse;
  abort(entryId: string): CacheResponse;
  check(body: {scope?: string; key: string; version?: string}): CacheResponse;
}

export function cacheClient(app: FastifyInstance, job: TestJob): CacheClient {
  const headers = {authorization: `Bearer ${job.token}`};
  const prefix = '/runs/jobs/current/cache';

  return {
    restore: (body: {
      scope?: string;
      fallback_scopes?: string[];
      key: string;
      restore_keys?: string[];
      version?: string;
    }) =>
      app.inject({
        method: 'POST',
        url: `${prefix}/restore`,
        headers,
        payload: {scope: 'default', version: VERSION, ...body},
      }),
    reserve: (input: ReserveInput) =>
      app.inject({
        method: 'POST',
        url: `${prefix}/entries`,
        headers,
        payload: {
          scope: input.scope ?? 'default',
          key: input.key,
          version: input.version ?? VERSION,
          size_bytes: input.body.length,
          sha256: sha256Of(input.body),
        },
      }),
    reserveRaw: (payload: Record<string, unknown>) =>
      app.inject({method: 'POST', url: `${prefix}/entries`, headers, payload}),
    commit: (entryId: string, parts: {number: number; etag: string}[]) =>
      app.inject({
        method: 'POST',
        url: `${prefix}/entries/${entryId}/commit`,
        headers,
        payload: {parts},
      }),
    abort: (entryId: string) =>
      app.inject({method: 'DELETE', url: `${prefix}/entries/${entryId}`, headers}),
    check: (body: {scope?: string; key: string; version?: string}) =>
      app.inject({
        method: 'POST',
        url: `${prefix}/entries/check`,
        headers,
        payload: {scope: 'default', version: VERSION, ...body},
      }),
  };
}

export interface Reservation {
  status: 'reserved';
  entry_id: string;
  part_size: number;
  part_urls: string[];
}

export async function uploadParts(
  reservation: Reservation,
  body: Uint8Array,
): Promise<{number: number; etag: string}[]> {
  return await Promise.all(
    reservation.part_urls.map(async (url, index) => {
      const start = index * reservation.part_size;
      const chunk = body.slice(start, start + reservation.part_size);
      const response = await fetch(url, {method: 'PUT', body: chunk});
      if (response.status !== 200) {
        throw new Error(
          `Part ${index + 1} upload failed: ${response.status} ${await response.text()}`,
        );
      }
      const etag = response.headers.get('etag');
      if (!etag) throw new Error(`Part ${index + 1} upload returned no ETag`);
      return {number: index + 1, etag};
    }),
  );
}

/** Reserves, uploads through the signed URLs, and commits. Returns the entry id. */
export async function saveEntry(
  app: FastifyInstance,
  job: TestJob,
  input: ReserveInput,
): Promise<string> {
  const client = cacheClient(app, job);
  const reserved = await client.reserve(input);
  const reservation = reserved.json() as Reservation;
  if (reservation.status !== 'reserved') {
    throw new Error(`Expected a reservation, got ${JSON.stringify(reservation)}`);
  }
  const committed = await client.commit(
    reservation.entry_id,
    await uploadParts(reservation, input.body),
  );
  if (committed.statusCode !== 200) {
    throw new Error(`Commit failed: ${committed.statusCode} ${committed.body}`);
  }
  return reservation.entry_id;
}

export function archiveOf(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

export function archiveOfSize(bytes: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes).fill(7);
}

export const MULTI_PART_BYTES = CACHE_PART_SIZE_BYTES + 1024;
