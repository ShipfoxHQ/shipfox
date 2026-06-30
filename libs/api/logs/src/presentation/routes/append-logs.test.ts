import {Buffer} from 'node:buffer';
import {createLeaseTokenAuthMethod} from '@shipfox/api-auth';
import {AUTH_USER} from '@shipfox/api-auth-context';
import {getStepByIdForJobExecution} from '@shipfox/api-workflows';
import {type AuthMethod, closeApp, createApp, type FastifyInstance} from '@shipfox/node-fastify';
import {mintLeaseToken} from '#test/fixtures/lease-token.js';
import {endLine, ndjsonBody, outputLine, recordLine} from '#test/fixtures/ndjson.js';
import {logsRoutes} from './index.js';

vi.mock('@shipfox/api-workflows', () => ({
  getStepByIdForJobExecution: vi.fn(),
  getTerminalStepAttemptLogState: vi.fn(),
}));

const mockedGetStepByIdForJobExecution = vi.mocked(getStepByIdForJobExecution);
const NDJSON = 'application/x-ndjson';
const JOB_EXECUTION_ID = '00000000-0000-4000-8000-0000000000ee';

// logsRoutes also carries the session-authed read group; register a no-op AUTH_USER method
// so auth-reference validation passes (these tests only exercise the lease append route).
const stubUserAuth: AuthMethod = {name: AUTH_USER, authenticate: () => Promise.resolve()};

function logsUrl(stepId: string, attempt: number, offset: number): string {
  return `/runs/jobs/current/steps/${stepId}/logs?attempt=${attempt}&offset=${offset}`;
}

function mintTestLeaseToken(jobId = crypto.randomUUID()): Promise<string> {
  return mintLeaseToken({jobId, jobExecutionId: JOB_EXECUTION_ID});
}

describe('POST /runs/jobs/current/steps/:stepId/logs', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createApp({
      auth: [createLeaseTokenAuthMethod(), stubUserAuth],
      routes: logsRoutes,
      swagger: false,
    });
    await app.ready();
  });

  beforeEach(() => {
    mockedGetStepByIdForJobExecution.mockResolvedValue({id: crypto.randomUUID()} as never);
  });

  afterAll(async () => {
    await closeApp();
  });

  it('rejects a request without a lease token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: logsUrl(crypto.randomUUID(), 1, 0),
      headers: {'content-type': NDJSON},
      payload: ndjsonBody(outputLine('hi\n')),
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('unauthorized');
  });

  it('accepts an in-order append and returns the committed length', async () => {
    const jobId = crypto.randomUUID();
    const stepId = crypto.randomUUID();
    const token = await mintTestLeaseToken(jobId);
    const body = ndjsonBody(outputLine('installing\n'));

    const res = await app.inject({
      method: 'POST',
      url: logsUrl(stepId, 1, 0),
      headers: {authorization: `Bearer ${token}`, 'content-type': NDJSON},
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({committed_length: body.length, capped: false});
    expect(mockedGetStepByIdForJobExecution).toHaveBeenCalledWith({
      stepId,
      jobExecutionId: JOB_EXECUTION_ID,
    });
  });

  it('rejects appends for a step outside the leased execution', async () => {
    const stepId = crypto.randomUUID();
    const token = await mintTestLeaseToken();
    mockedGetStepByIdForJobExecution.mockResolvedValue(undefined);

    const res = await app.inject({
      method: 'POST',
      url: logsUrl(stepId, 1, 0),
      headers: {authorization: `Bearer ${token}`, 'content-type': NDJSON},
      payload: ndjsonBody(outputLine('wrong execution\n')),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('step-not-found');
    expect(mockedGetStepByIdForJobExecution).toHaveBeenCalledWith({
      stepId,
      jobExecutionId: JOB_EXECUTION_ID,
    });
  });

  it('acks a re-sent append at an earlier offset', async () => {
    const jobId = crypto.randomUUID();
    const stepId = crypto.randomUUID();
    const token = await mintTestLeaseToken(jobId);
    const body = ndjsonBody(outputLine('once\n'));
    await app.inject({
      method: 'POST',
      url: logsUrl(stepId, 1, 0),
      headers: {authorization: `Bearer ${token}`, 'content-type': NDJSON},
      payload: body,
    });

    const res = await app.inject({
      method: 'POST',
      url: logsUrl(stepId, 1, 0),
      headers: {authorization: `Bearer ${token}`, 'content-type': NDJSON},
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({committed_length: body.length, capped: false});
  });

  it('rejects an offset gap with 409 and the committed length', async () => {
    const jobId = crypto.randomUUID();
    const stepId = crypto.randomUUID();
    const token = await mintTestLeaseToken(jobId);
    const body = ndjsonBody(outputLine('first\n'));
    await app.inject({
      method: 'POST',
      url: logsUrl(stepId, 1, 0),
      headers: {authorization: `Bearer ${token}`, 'content-type': NDJSON},
      payload: body,
    });

    const res = await app.inject({
      method: 'POST',
      url: logsUrl(stepId, 1, body.length + 10),
      headers: {authorization: `Bearer ${token}`, 'content-type': NDJSON},
      payload: ndjsonBody(outputLine('gap\n')),
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('offset-gap');
    expect(res.json().details).toEqual({committed_length: body.length});
  });

  it('rejects a forged server-only tombstone with 400', async () => {
    const token = await mintTestLeaseToken();

    const res = await app.inject({
      method: 'POST',
      url: logsUrl(crypto.randomUUID(), 1, 0),
      headers: {authorization: `Bearer ${token}`, 'content-type': NDJSON},
      payload: ndjsonBody(recordLine({type: 'capped'})),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('malformed-log-chunk');
  });

  it('rejects a body that is not newline-terminated with 400', async () => {
    const token = await mintTestLeaseToken();

    const res = await app.inject({
      method: 'POST',
      url: logsUrl(crypto.randomUUID(), 1, 0),
      headers: {authorization: `Bearer ${token}`, 'content-type': NDJSON},
      payload: '{"v":1,"ts":1,"type":"output","stream":"stdout","data":"no newline"}',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('malformed-log-chunk');
  });

  it('rejects a record whose data exceeds the per-record byte cap with 400', async () => {
    const token = await mintTestLeaseToken();

    const res = await app.inject({
      method: 'POST',
      url: logsUrl(crypto.randomUUID(), 1, 0),
      headers: {authorization: `Bearer ${token}`, 'content-type': NDJSON},
      payload: ndjsonBody(outputLine('x'.repeat(16 * 1024 + 1))),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('malformed-log-chunk');
  });

  it('treats an empty body as a no-op', async () => {
    const token = await mintTestLeaseToken();

    const res = await app.inject({
      method: 'POST',
      url: logsUrl(crypto.randomUUID(), 1, 0),
      headers: {authorization: `Bearer ${token}`, 'content-type': NDJSON},
      payload: '',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({committed_length: 0, capped: false});
  });

  it('rejects a non-ndjson content type with 415', async () => {
    const token = await mintTestLeaseToken();

    const res = await app.inject({
      method: 'POST',
      url: logsUrl(crypto.randomUUID(), 1, 0),
      headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'},
      payload: '{"hello":"world"}',
    });

    expect(res.statusCode).toBe(415);
  });

  it('rejects a body over the configured size limit with 413', async () => {
    const token = await mintTestLeaseToken();
    // Test body limit is 64 KiB (LOG_APPEND_BODY_LIMIT_BYTES in test/env.ts).
    const oversize = Buffer.alloc(65536 + 1024, 0x61).toString('utf8');

    const res = await app.inject({
      method: 'POST',
      url: logsUrl(crypto.randomUUID(), 1, 0),
      headers: {authorization: `Bearer ${token}`, 'content-type': NDJSON},
      payload: oversize,
    });

    expect(res.statusCode).toBe(413);
  });

  it('reports capped once the budget is crossed', async () => {
    const jobId = crypto.randomUUID();
    const token = await mintTestLeaseToken(jobId);

    const res = await app.inject({
      method: 'POST',
      url: logsUrl(crypto.randomUUID(), 1, 0),
      headers: {authorization: `Bearer ${token}`, 'content-type': NDJSON},
      payload: ndjsonBody(outputLine('x'.repeat(150)), endLine(150)),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().capped).toBe(true);
  });
});
