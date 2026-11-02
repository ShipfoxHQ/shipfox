import {setTimeout as sleep} from 'node:timers/promises';
import {claimQueuedConversationItems} from '#db/conversations.js';
import {conversationStreamTickSeconds} from '#metrics/index.js';
import {conversationFactory} from '#test/factories/conversation.js';
import {turnFactory} from '#test/factories/turn.js';
import {storeReply, storeStreamChunk} from '#test/fixtures/conversation-stream.js';
import {streamConversation} from './conversation-stream.js';

/**
 * Load test for stream tailing against chunk writes. It is off by default, because it runs for
 * a while and measures the database it runs on. Run it with:
 *
 *   STREAM_LOAD_TEST=1 STREAM_LOAD_STREAMS=100 STREAM_LOAD_INTERVAL_MS=150 \
 *   POSTGRES_MAX_CONNECTIONS=40 turbo test --filter=@shipfox/api-agent -- conversation-stream.load
 *
 * Every stream follows a running turn whose model call writes one chunk every 150 ms and stores
 * its reply every 20 chunks, which deletes them. That is the churn on `turn_stream_chunks`.
 */
const enabled = process.env.STREAM_LOAD_TEST === '1';
const STREAMS = Number(process.env.STREAM_LOAD_STREAMS ?? 100);
const INTERVAL_MS = Number(process.env.STREAM_LOAD_INTERVAL_MS ?? 150);
const SECONDS = Number(process.env.STREAM_LOAD_SECONDS ?? 30);
const CHUNK_INTERVAL_MS = 150;
const CHUNKS_PER_CALL = 20;
const CHUNK_TEXT = 'a short run of streamed text, about thirty tokens long, as a model sends it. ';

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] as number;
}

function summarize(valuesMs: number[]) {
  const sorted = [...valuesMs].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: Number(percentile(sorted, 0.5).toFixed(2)),
    p95: Number(percentile(sorted, 0.95).toFixed(2)),
    p99: Number(percentile(sorted, 0.99).toFixed(2)),
    max: Number((sorted.at(-1) ?? 0).toFixed(2)),
  };
}

async function arrangeStreams() {
  return await Promise.all(
    Array.from({length: STREAMS}, async () => {
      const {conversation} = await conversationFactory.create();
      await claimQueuedConversationItems(conversation.id);
      const turn = await turnFactory.create({conversationId: conversation.id});
      return {conversation, turnId: turn.id};
    }),
  );
}

describe.skipIf(!enabled)('conversation stream load', () => {
  it(
    `tails ${STREAMS} streams every ${INTERVAL_MS} ms while their calls write chunks`,
    async () => {
      const targets = await arrangeStreams();
      const tickMs: number[] = [];
      const writeMs: number[] = [];
      let events = 0;
      vi.spyOn(conversationStreamTickSeconds, 'record').mockImplementation((seconds) => {
        tickMs.push(seconds * 1000);
      });
      const controller = new AbortController();

      const writers = targets.map(async ({conversation, turnId}) => {
        let modelCallIndex = 0;
        let chunkSeq = 0;
        await sleep(Math.random() * CHUNK_INTERVAL_MS);
        while (!controller.signal.aborted) {
          const startedAt = performance.now();
          if (chunkSeq === CHUNKS_PER_CALL) {
            await storeReply({conversation, turnId, modelCallIndex, text: CHUNK_TEXT});
            modelCallIndex += 1;
            chunkSeq = 0;
          } else {
            await storeStreamChunk({
              conversation,
              turnId,
              modelCallIndex,
              chunkSeq,
              text: CHUNK_TEXT,
            });
            chunkSeq += 1;
          }
          writeMs.push(performance.now() - startedAt);
          await sleep(CHUNK_INTERVAL_MS, undefined, {signal: controller.signal}).catch(
            () => undefined,
          );
        }
      });
      const readers = targets.map(async ({conversation}) => {
        const stream = streamConversation({
          conversation,
          afterSeq: 0,
          signal: controller.signal,
          intervalMs: INTERVAL_MS,
          maxDurationMs: (SECONDS + 5) * 1000,
        });
        for await (const _event of stream) events += 1;
      });

      const startedAt = performance.now();
      await sleep(SECONDS * 1000);
      controller.abort();
      await Promise.all([...writers, ...readers]);
      const elapsedSeconds = (performance.now() - startedAt) / 1000;

      const summary = {
        streams: STREAMS,
        intervalMs: INTERVAL_MS,
        seconds: Number(elapsedSeconds.toFixed(1)),
        poolSize: process.env.POSTGRES_MAX_CONNECTIONS,
        ticksPerSecond: Math.round(tickMs.length / elapsedSeconds),
        eventsPerSecond: Math.round(events / elapsedSeconds),
        tickMs: summarize(tickMs),
        chunkWriteMs: summarize(writeMs),
      };
      process.stdout.write(`STREAM_LOAD_RESULT ${JSON.stringify(summary)}\n`);

      expect(tickMs.length).toBeGreaterThan(0);
    },
    (SECONDS + 60) * 1000,
  );
});
