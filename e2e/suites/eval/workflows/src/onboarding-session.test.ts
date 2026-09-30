import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {SDKMessage} from '@anthropic-ai/claude-agent-sdk';
import {afterEach, describe, expect, it} from '@shipfox/vitest/vi';
import {parseClaudeTranscript} from './claude-transcript.js';
import {
  agentEnvironment,
  type ClaudeQuery,
  endsWithQuestion,
  runOnboardingSession,
} from './onboarding-session.js';
import {collectWorkflowFiles} from './onboarding-workspace.js';
import type {SimulatedUser} from './simulated-user.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, {recursive: true})));
});

function assistant(text: string, extra: object[] = []): SDKMessage {
  return {
    type: 'assistant',
    parent_tool_use_id: null,
    message: {
      id: `msg-${Math.random()}`,
      role: 'assistant',
      content: [{type: 'text', text}, ...extra],
    },
  } as unknown as SDKMessage;
}

function result(text: string, cost = 0.5, subtype = 'success'): SDKMessage {
  return {
    type: 'result',
    subtype,
    result: text,
    total_cost_usd: cost,
    modelUsage: {
      'claude-sonnet-5-5': {
        inputTokens: 100,
        outputTokens: 20,
        cacheReadInputTokens: 5,
        cacheCreationInputTokens: 1,
      },
    },
  } as unknown as SDKMessage;
}

/** Replays one script step per user message, as the SDK does in streaming input mode. */
function scriptedQuery(turns: SDKMessage[][]): {query: ClaudeQuery; prompts: string[]} {
  const prompts: string[] = [];
  const query: ClaudeQuery = ({prompt}) =>
    (async function* () {
      const iterator = prompt[Symbol.asyncIterator]();
      for (const messages of turns) {
        const next = await iterator.next();
        if (next.done) return;
        const content = next.value.message.content;
        prompts.push(typeof content === 'string' ? content : '');
        yield* messages;
      }
    })();
  return {query, prompts};
}

const answering = (answers: string[]): SimulatedUser => ({
  answer: async () => ({
    text: answers.shift() ?? "I don't know",
    usage: {input_tokens: 7, output_tokens: 2},
  }),
});

const baseOptions = {
  prompt: 'Set up a workflow',
  cwd: '/tmp/repo',
  mcpUrl: 'http://127.0.0.1:1/session/mcp',
  maxTurns: 10,
  timeoutSeconds: 60,
  env: {},
};

describe('runOnboardingSession', () => {
  it('answers the agent question and stops when the agent ends without one', async () => {
    const {query, prompts} = scriptedQuery([
      [assistant('Which tracker do you use?'), result('Which tracker do you use?', 0.2)],
      [assistant('Done.'), result('Done. The workflow is written.', 0.5)],
    ]);

    const session = await runOnboardingSession({
      ...baseOptions,
      query,
      simulatedUser: answering(['Linear']),
    });

    expect(prompts).toEqual(['Set up a workflow', 'Linear']);
    expect(session).toMatchObject({
      stop_reason: 'completed',
      turns: 2,
      final_message: 'Done. The workflow is written.',
      questions: [{question: 'Which tracker do you use?', answer: 'Linear'}],
    });
    expect(session.usage.simulator).toEqual({input_tokens: 7, output_tokens: 2});
    expect(session.usage.agent).toMatchObject({
      cost_usd: 0.5,
      input_tokens: 100,
      output_tokens: 20,
    });
  });

  it('writes a transcript the Claude exporter reads, with the simulated user in it', async () => {
    const {query} = scriptedQuery([
      [assistant('Which tracker do you use?'), result('Which tracker do you use?')],
      [assistant('Done.'), result('Done.')],
    ]);

    const session = await runOnboardingSession({
      ...baseOptions,
      query,
      simulatedUser: answering(['Linear']),
    });

    const parsed = parseClaudeTranscript({jsonl: session.transcript_jsonl});
    expect(parsed.turns.map((turn) => turn.prompt)).toEqual(['Set up a workflow', 'Linear']);
  });

  it('starts the agent with the isolation options and the proxy as its only MCP server', async () => {
    let seen: Parameters<ClaudeQuery>[0]['options'] | undefined;
    const query: ClaudeQuery = ({prompt, options}) => {
      seen = options;
      return (async function* () {
        await prompt[Symbol.asyncIterator]().next();
        yield result('Done.');
      })();
    };

    await runOnboardingSession({...baseOptions, query, simulatedUser: answering([])});

    expect(seen).toMatchObject({
      cwd: '/tmp/repo',
      settingSources: [],
      strictMcpConfig: true,
      mcpServers: {shipfox: {type: 'http', url: 'http://127.0.0.1:1/session/mcp'}},
      env: {},
    });
  });

  it('stops at the turn limit', async () => {
    const {query} = scriptedQuery([[assistant('one'), assistant('two'), assistant('three')]]);

    const session = await runOnboardingSession({
      ...baseOptions,
      maxTurns: 2,
      query,
      simulatedUser: answering([]),
    });

    expect(session.stop_reason).toBe('max_turns');
    expect(session.turns).toBe(3);
  });

  it('does not answer a question that would need a turn beyond the limit', async () => {
    const {query, prompts} = scriptedQuery([
      [assistant('Which tracker?'), result('Which tracker?')],
      [assistant('Done.'), result('Done.')],
    ]);

    const session = await runOnboardingSession({
      ...baseOptions,
      maxTurns: 1,
      query,
      simulatedUser: answering(['Linear']),
    });

    expect(session).toMatchObject({stop_reason: 'max_turns', questions: []});
    expect(prompts).toEqual(['Set up a workflow']);
  });

  it('cancels a pending simulated answer at the timeout', async () => {
    const {query} = scriptedQuery([[assistant('Which tracker?'), result('Which tracker?')]]);
    const simulatedUser: SimulatedUser = {
      answer: (_question, {signal} = {}) =>
        new Promise((_, reject) =>
          signal?.addEventListener('abort', () => reject(new Error('answer aborted'))),
        ),
    };

    const session = await runOnboardingSession({
      ...baseOptions,
      timeoutSeconds: 0.05,
      query,
      simulatedUser,
    });

    expect(session.stop_reason).toBe('timeout');
  });

  it('stops at the timeout and keeps what the agent did so far', async () => {
    const query: ClaudeQuery = ({options}) =>
      (async function* () {
        yield assistant('Working on it.');
        await new Promise((_, reject) =>
          options.abortController?.signal.addEventListener('abort', () =>
            reject(new Error('aborted')),
          ),
        );
      })();

    const session = await runOnboardingSession({
      ...baseOptions,
      timeoutSeconds: 0.05,
      drainSeconds: 0.05,
      query,
      simulatedUser: answering([]),
    });

    expect(session).toMatchObject({stop_reason: 'timeout', final_message: 'Working on it.'});
    expect(session.error).toContain('timeout');
  });

  it('interrupts the agent at the turn limit and reports the usage of its result', async () => {
    let interrupted = false;
    const query: ClaudeQuery = () => {
      let release: () => void = () => undefined;
      const interruption = new Promise<void>((resolve) => {
        release = resolve;
      });
      return Object.assign(
        (async function* () {
          yield assistant('one');
          yield assistant('two');
          yield assistant('three');
          await interruption;
          yield result('', 1.5, 'error_during_execution');
        })(),
        {
          interrupt: () => {
            interrupted = true;
            release();
            return Promise.resolve();
          },
        },
      );
    };

    const session = await runOnboardingSession({
      ...baseOptions,
      maxTurns: 2,
      query,
      simulatedUser: answering([]),
    });

    expect(interrupted).toBe(true);
    expect(session).toMatchObject({stop_reason: 'max_turns', turns: 3});
    expect(session.usage.agent).toMatchObject({cost_usd: 1.5, input_tokens: 100});
    expect(session.transcript_jsonl).toContain('error_during_execution');
  });

  it('interrupts the agent at the timeout and reports the usage of its result', async () => {
    const query: ClaudeQuery = () => {
      let release: () => void = () => undefined;
      const interruption = new Promise<void>((resolve) => {
        release = resolve;
      });
      return Object.assign(
        (async function* () {
          yield assistant('Working on it.');
          await interruption;
          yield result('', 2.5, 'error_during_execution');
        })(),
        {interrupt: () => Promise.resolve(release())},
      );
    };

    const session = await runOnboardingSession({
      ...baseOptions,
      timeoutSeconds: 0.05,
      query,
      simulatedUser: answering([]),
    });

    expect(session).toMatchObject({stop_reason: 'timeout', final_message: 'Working on it.'});
    expect(session.usage.agent.cost_usd).toBe(2.5);
  });

  it('aborts a query that never reports its result once the drain time is over', async () => {
    const query: ClaudeQuery = ({options}) =>
      Object.assign(
        (async function* () {
          yield assistant('Working on it.');
          await new Promise((_, reject) =>
            options.abortController?.signal.addEventListener('abort', () =>
              reject(new Error('aborted')),
            ),
          );
        })(),
        {interrupt: () => Promise.resolve()},
      );

    const session = await runOnboardingSession({
      ...baseOptions,
      timeoutSeconds: 0.05,
      drainSeconds: 0.05,
      query,
      simulatedUser: answering([]),
    });

    expect(session).toMatchObject({stop_reason: 'timeout'});
    expect(session.usage.agent.cost_usd).toBe(0);
  });

  it('reports an SDK failure instead of throwing', async () => {
    const query: ClaudeQuery = () =>
      (async function* () {
        yield* [];
        throw new Error('spawn failed');
      })();

    const session = await runOnboardingSession({
      ...baseOptions,
      query,
      simulatedUser: answering([]),
    });

    expect(session).toMatchObject({stop_reason: 'error', error: 'spawn failed'});
  });

  it('fails fast when the API rejects the key instead of waiting for the timeout', async () => {
    const {query} = scriptedQuery([
      [
        {
          type: 'system',
          subtype: 'api_retry',
          error: 'authentication_failed',
        } as unknown as SDKMessage,
      ],
    ]);

    const session = await runOnboardingSession({
      ...baseOptions,
      query,
      simulatedUser: answering([]),
    });

    expect(session).toMatchObject({stop_reason: 'error'});
    expect(session.error).toContain('authentication_failed');
  });

  it('keeps waiting through a retryable API error', async () => {
    const {query} = scriptedQuery([
      [
        {type: 'system', subtype: 'api_retry', error: 'overloaded'} as unknown as SDKMessage,
        assistant('Done.'),
        result('Done.'),
      ],
    ]);

    const session = await runOnboardingSession({
      ...baseOptions,
      query,
      simulatedUser: answering([]),
    });

    expect(session.stop_reason).toBe('completed');
  });

  it('maps a budget stop and an error result to their reasons', async () => {
    const budget = scriptedQuery([[result('', 1, 'error_max_budget_usd')]]);
    const failure = scriptedQuery([[result('', 1, 'error_during_execution')]]);

    const first = await runOnboardingSession({
      ...baseOptions,
      ...budget,
      simulatedUser: answering([]),
    });
    const second = await runOnboardingSession({
      ...baseOptions,
      ...failure,
      simulatedUser: answering([]),
    });

    expect(first.stop_reason).toBe('budget');
    expect(second.stop_reason).toBe('error');
  });
});

describe('endsWithQuestion', () => {
  it.each([
    ['Which tracker do you use?', true],
    ['**Should I open the PR now?**', true],
    ['I wrote the file.\n\nShould I open the PR now?\n1. Yes\n2. No?', true],
    ['Done. Ask me if you need anything else.', false],
    ['Why? Because the template needs it.', false],
  ])('%j -> %s', (message, expected) => {
    expect(endsWithQuestion(message)).toBe(expected);
  });
});

describe('agentEnvironment', () => {
  it('passes only the key, the isolated home, and the path', () => {
    expect(agentEnvironment({apiKey: 'k', home: '/tmp/h', path: '/usr/bin'})).toEqual({
      ANTHROPIC_API_KEY: 'k',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      CLAUDE_CONFIG_DIR: '/tmp/h/.claude',
      HOME: '/tmp/h',
      PATH: '/usr/bin',
    });
  });
});

describe('collectWorkflowFiles', () => {
  it('returns the files written under .shipfox/workflows, sorted', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'eval-collect-'));
    directories.push(cwd);
    await mkdir(join(cwd, '.shipfox/workflows'), {recursive: true});
    await writeFile(join(cwd, '.shipfox/workflows/b.yml'), 'b');
    await writeFile(join(cwd, '.shipfox/workflows/a.yml'), 'a');
    await writeFile(join(cwd, 'README.md'), 'ignored');

    expect(await collectWorkflowFiles(cwd)).toEqual([
      {path: '.shipfox/workflows/a.yml', content: 'a'},
      {path: '.shipfox/workflows/b.yml', content: 'b'},
    ]);
  });

  it('returns nothing when the agent wrote no workflow', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'eval-collect-'));
    directories.push(cwd);

    expect(await collectWorkflowFiles(cwd)).toEqual([]);
  });
});
