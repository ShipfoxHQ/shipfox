import type {Buffer} from 'node:buffer';
import {requireAgentLogDownloadContext} from '@shipfox/api-auth-context';
import {ClientError, defineRoute, type FastifyReply} from '@shipfox/node-fastify';
import {presignedAgentLogDownloadUrl} from '#api/object-storage.js';
import {config} from '#config.js';
import type {AttemptStream} from '#core/entities/attempt-stream.js';
import {chunkStats, readChunkPageBySeqSnapshot} from '#db/chunks.js';
import {getAttemptStreamById} from '#db/streams.js';
import type {AgentDownloadRequestOutcome} from '#metrics/downloads.js';
import {agentDownloadRequests} from '#metrics/downloads.js';

const HOT_DOWNLOAD_CAPACITY = 8;
const RETRY_AFTER_SECONDS = 5;
let activeHotDownloads = 0;

type HotDownloadOutcome = 'streamed' | 'seam-aborted' | 'failed';

function recordDownload(outcome: AgentDownloadRequestOutcome): void {
  agentDownloadRequests.add(1, {outcome});
}

function notFound(): ClientError {
  return new ClientError('Logs not found', 'not-found', {status: 404});
}

function acquireHotDownload(): boolean {
  if (activeHotDownloads >= HOT_DOWNLOAD_CAPACITY) return false;
  activeHotDownloads += 1;
  return true;
}

function releaseHotDownload(): void {
  activeHotDownloads -= 1;
}

function writeHotHeaders(reply: FastifyReply): void {
  reply.hijack();
  reply.raw.writeHead(200, {
    'Content-Type': 'application/x-ndjson',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
}

function responseClosedError(): Error {
  return new Error('Response closed while writing log download');
}

function responseIsClosed(reply: FastifyReply): boolean {
  return reply.raw.destroyed || reply.raw.writableEnded;
}

export async function writePage(reply: FastifyReply, data: Buffer): Promise<void> {
  if (data.length === 0) return;
  if (responseIsClosed(reply)) throw responseClosedError();

  const accepted = reply.raw.write(data);
  if (responseIsClosed(reply)) throw responseClosedError();
  if (accepted) return;

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      reply.raw.off('drain', onDrain);
      reply.raw.off('close', onClose);
      reply.raw.off('error', onError);
    };
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onDrain = () => settle(resolve);
    const onClose = () => settle(() => reject(responseClosedError()));
    const onError = (error: Error) => settle(() => reject(error));

    reply.raw.once('drain', onDrain);
    reply.raw.once('close', onClose);
    reply.raw.once('error', onError);
    if (responseIsClosed(reply)) onClose();
  });
}

function destroyResponse(reply: FastifyReply): void {
  if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.destroy();
}

async function streamHotDownload(
  reply: FastifyReply,
  stream: AttemptStream,
  snapshot: {maxSeq: number; totalBytes: number},
): Promise<HotDownloadOutcome> {
  writeHotHeaders(reply);
  let afterSeq = 0;
  let deliveredBytes = 0;

  try {
    while (afterSeq !== snapshot.maxSeq) {
      const page = await readChunkPageBySeqSnapshot({
        streamId: stream.id,
        afterSeq,
        maxSeq: snapshot.maxSeq,
        maxBytes: config.LOG_READ_INLINE_MAX_BYTES,
      });

      const shortPage = page.deliveredRowCount !== page.selectedRowCount;
      const emptyBeforeBoundary = page.data.length === 0;
      if (shortPage || emptyBeforeBoundary) {
        destroyResponse(reply);
        return 'seam-aborted';
      }

      await writePage(reply, page.data);
      deliveredBytes += page.deliveredBytes;
      afterSeq = page.nextSeq;

      if (afterSeq === snapshot.maxSeq) break;
      if (!page.hasMore) {
        destroyResponse(reply);
        return 'seam-aborted';
      }
    }

    if (afterSeq !== snapshot.maxSeq || deliveredBytes !== snapshot.totalBytes) {
      destroyResponse(reply);
      return 'seam-aborted';
    }

    reply.raw.end();
    return 'streamed';
  } catch {
    destroyResponse(reply);
    return 'failed';
  }
}

export const stepLogDownloadRoute = defineRoute({
  method: 'GET',
  path: '/current',
  description: 'Download the complete NDJSON log for the stream bound to the bearer token.',
  handler: async (request, reply) => {
    const claim = requireAgentLogDownloadContext(request);
    let acquired = false;

    try {
      const stream = await getAttemptStreamById(claim.streamId);
      if (!stream || stream.workspaceId !== claim.workspaceId) {
        recordDownload('rejected');
        throw notFound();
      }

      if (stream.objectKey) {
        const {url} = await presignedAgentLogDownloadUrl(stream.objectKey);
        recordDownload('redirected');
        return reply.code(302).header('location', url).header('cache-control', 'no-store').send();
      }

      const stats = await chunkStats(stream.id);
      if (stats.count === 0) {
        const refreshed = await getAttemptStreamById(stream.id);
        if (!refreshed || refreshed.workspaceId !== claim.workspaceId) {
          recordDownload('rejected');
          throw notFound();
        }
        if (refreshed.objectKey) {
          const {url} = await presignedAgentLogDownloadUrl(refreshed.objectKey);
          recordDownload('redirected');
          return reply.code(302).header('location', url).header('cache-control', 'no-store').send();
        }

        writeHotHeaders(reply);
        reply.raw.end();
        recordDownload('streamed');
        return;
      }

      if (!acquireHotDownload()) {
        recordDownload('over-capacity');
        return reply
          .code(503)
          .header('retry-after', String(RETRY_AFTER_SECONDS))
          .send({code: 'over-capacity'});
      }
      acquired = true;

      const outcome = await streamHotDownload(reply, stream, {
        maxSeq: stats.maxSeq,
        totalBytes: stats.uncompressedBytes,
      });
      recordDownload(outcome);
    } catch (error) {
      if (error instanceof ClientError) throw error;
      recordDownload('failed');
      throw error;
    } finally {
      if (acquired) releaseHotDownload();
    }
  },
});
