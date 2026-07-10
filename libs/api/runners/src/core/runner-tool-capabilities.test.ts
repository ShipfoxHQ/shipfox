import type {RunnerToolCapabilitiesDto} from '@shipfox/api-runners-dto';
import {eq, sql} from 'drizzle-orm';
import {db} from '#db/db.js';
import {runnerSessions} from '#db/schema/runner-sessions.js';
import {runnerSessionFactory} from '#test/index.js';
import {
  effectiveRunnerToolCapabilities,
  getEffectiveRunnerToolCapabilities,
  unadvertisedRunnerTools,
} from './runner-tool-capabilities.js';

const capabilities: RunnerToolCapabilitiesDto = {
  harnesses: {
    pi: {tools: ['read', 'bash']},
  },
};

describe('effectiveRunnerToolCapabilities', () => {
  it('returns an empty set when the report is missing', () => {
    const effective = effectiveRunnerToolCapabilities({
      toolCapabilities: null,
      reportedAt: new Date('2026-01-01T00:00:00.000Z'),
      staleAfterSeconds: 10,
      now: new Date('2026-01-01T00:00:01.000Z'),
    });

    expect(effective).toEqual({harnesses: {}});
  });

  it('returns an empty set when the report timestamp is missing', () => {
    const effective = effectiveRunnerToolCapabilities({
      toolCapabilities: capabilities,
      reportedAt: null,
      staleAfterSeconds: 10,
      now: new Date('2026-01-01T00:00:01.000Z'),
    });

    expect(effective).toEqual({harnesses: {}});
  });

  it('returns an empty set when the report is stale', () => {
    const effective = effectiveRunnerToolCapabilities({
      toolCapabilities: capabilities,
      reportedAt: new Date('2026-01-01T00:00:00.000Z'),
      staleAfterSeconds: 10,
      now: new Date('2026-01-01T00:00:11.000Z'),
    });

    expect(effective).toEqual({harnesses: {}});
  });

  it('returns exact persisted tools when the report is fresh', () => {
    const effective = effectiveRunnerToolCapabilities({
      toolCapabilities: capabilities,
      reportedAt: new Date('2026-01-01T00:00:00.000Z'),
      staleAfterSeconds: 10,
      now: new Date('2026-01-01T00:00:10.000Z'),
    });

    expect(effective).toBe(capabilities);
  });
});

describe('unadvertisedRunnerTools', () => {
  it('returns no tools when every requested tool is advertised', () => {
    const missing = unadvertisedRunnerTools({
      harness: 'pi',
      requestedTools: ['read', 'bash'],
      capabilities,
    });

    expect(missing).toEqual([]);
  });

  it('returns the missing subset in requested order', () => {
    const missing = unadvertisedRunnerTools({
      harness: 'pi',
      requestedTools: ['read', 'web_search', 'bash', 'get_search_content'],
      capabilities,
    });

    expect(missing).toEqual(['web_search', 'get_search_content']);
  });

  it('returns every requested tool when the harness has no advertised tools', () => {
    const missing = unadvertisedRunnerTools({
      harness: 'claude',
      requestedTools: ['read', 'bash'],
      capabilities,
    });

    expect(missing).toEqual(['read', 'bash']);
  });

  it('matches tool names exactly across harnesses', () => {
    const missing = unadvertisedRunnerTools({
      harness: 'claude',
      requestedTools: ['read', 'Read'],
      capabilities: {harnesses: {claude: {tools: ['read']}, pi: {tools: ['Read']}}},
    });

    expect(missing).toEqual(['Read']);
  });
});

describe('getEffectiveRunnerToolCapabilities', () => {
  it('returns fresh capabilities and reports the harness as known', async () => {
    const runnerSession = await runnerSessionFactory.create({toolCapabilities: capabilities});

    const result = await getEffectiveRunnerToolCapabilities({runnerSessionId: runnerSession.id});

    expect(result.capabilities).toEqual(capabilities);
    expect(result.reportFresh).toBe(true);
    expect(result.harnessKnown('pi')).toBe(true);
    expect(result.harnessKnown('claude')).toBe(false);
  });

  it('treats missing capabilities as unknown', async () => {
    const runnerSession = await runnerSessionFactory.create({toolCapabilities: null});

    const result = await getEffectiveRunnerToolCapabilities({runnerSessionId: runnerSession.id});

    expect(result.capabilities).toEqual({harnesses: {}});
    expect(result.reportFresh).toBe(false);
    expect(result.harnessKnown('pi')).toBe(false);
  });

  it('treats stale capabilities as unknown', async () => {
    const runnerSession = await runnerSessionFactory.create({toolCapabilities: capabilities});
    await db()
      .update(runnerSessions)
      .set({toolCapabilitiesReportedAt: sql`now() - interval '1 hour'`})
      .where(eq(runnerSessions.id, runnerSession.id));

    const result = await getEffectiveRunnerToolCapabilities({runnerSessionId: runnerSession.id});

    expect(result.capabilities).toEqual({harnesses: {}});
    expect(result.reportFresh).toBe(false);
    expect(result.harnessKnown('pi')).toBe(false);
  });
});
