import type {RunnerToolCapabilitiesDto} from '@shipfox/api-runners-dto';
import {runnerSessionFactory} from '#test/index.js';
import {
  getEffectiveRunnerToolCapabilities,
  unadvertisedRunnerTools,
} from './runner-tool-capabilities.js';

const capabilities: RunnerToolCapabilitiesDto = {
  harnesses: {
    pi: {tools: ['read', 'bash']},
  },
};

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
  it('returns stored capabilities and reports the harness as known', async () => {
    const runnerSession = await runnerSessionFactory.create({toolCapabilities: capabilities});

    const result = await getEffectiveRunnerToolCapabilities({runnerSessionId: runnerSession.id});

    expect(result.capabilities).toEqual(capabilities);
    expect(result.harnessKnown('pi')).toBe(true);
    expect(result.harnessKnown('claude')).toBe(false);
  });

  it('treats missing capabilities as unknown', async () => {
    const runnerSession = await runnerSessionFactory.create({toolCapabilities: null});

    const result = await getEffectiveRunnerToolCapabilities({runnerSessionId: runnerSession.id});

    expect(result.capabilities).toEqual({harnesses: {}});
    expect(result.harnessKnown('pi')).toBe(false);
  });
});
