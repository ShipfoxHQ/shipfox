import {chmod, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {query} from '@anthropic-ai/claude-agent-sdk';
import {createBashTool} from '@earendil-works/pi-coding-agent';
import {localExecutionHost} from '@shipfox/runner-container';
import {createClaudeProcessSpawner} from '#core/claude-spawn.js';
import {withDefaultOomScoreShellPrefix} from '#core/oom-score.js';

const SCORE_PATH = '/proc/self/oom_score_adj';

describe.runIf(process.platform === 'linux')('agent subprocess OOM score', () => {
  let runnerScore: string;
  let root: string;

  beforeEach(async () => {
    runnerScore = (await readFile(SCORE_PATH, 'utf8')).trim();
    await writeFile(SCORE_PATH, '300');
    root = await mkdtemp(join(tmpdir(), 'shipfox-oom-score-'));
  });

  afterEach(async () => {
    await writeFile(SCORE_PATH, runnerScore);
    await rm(root, {recursive: true, force: true});
  });

  it('starts a local host process at the default score', async () => {
    const child = localExecutionHost.spawn({
      argv: ['cat', SCORE_PATH],
      env: {PATH: process.env.PATH ?? ''},
    });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));

    await child.exited;

    expect(Buffer.concat(chunks).toString().trim()).toBe('0');
  });

  it('runs Pi bash commands at the default score', async () => {
    const commandPrefix = withDefaultOomScoreShellPrefix(undefined);
    const bash = createBashTool(root, commandPrefix === undefined ? {} : {commandPrefix});

    const result = await bash.execute('call-1', {command: `cat ${SCORE_PATH}`});

    expect(result.content).toEqual([{type: 'text', text: '0\n'}]);
  });

  it('starts Claude Code through the SDK at the default score', async () => {
    const scoreFile = join(root, 'score');
    const claudeCode = join(root, 'claude');
    await writeFile(claudeCode, `#!/bin/sh\ncat ${SCORE_PATH} > "$SCORE_FILE"\n`);
    await chmod(claudeCode, 0o755);

    const messages = query({
      prompt: 'ping',
      options: {
        pathToClaudeCodeExecutable: claudeCode,
        spawnClaudeCodeProcess: createClaudeProcessSpawner(localExecutionHost).spawn,
        env: {...process.env, SCORE_FILE: scoreFile},
      },
    });
    try {
      for await (const _message of messages) {
        // The fake Claude Code exits without replying.
      }
    } catch {
      // Whether the SDK reports the silent exit is not under test.
    }

    expect((await readFile(scoreFile, 'utf8')).trim()).toBe('0');
  });
});
