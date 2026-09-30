import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, describe, expect, it} from '@shipfox/vitest/vi';
import {discoverCases} from './discovery.js';
import {loadScriptedEntries, parseScriptedEntries} from './scripted.js';

const temporaryDirectories: string[] = [];
const invalidReplyPattern = /scripted\.yaml: 0\.replies\.0: Invalid input/u;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, {recursive: true})),
  );
});

describe('scripted.yaml', () => {
  it('rejects a reply that is neither text nor a tool call and accepts the corrected one', () => {
    const typo = [{match: {prompt_contains: 'Implement'}, replies: [{txt: 'Done.'}]}];
    const fixed = [{match: {prompt_contains: 'Implement'}, replies: [{text: 'Done.'}]}];

    expect(() => parseScriptedEntries(typo)).toThrow(invalidReplyPattern);
    expect(parseScriptedEntries(fixed)).toEqual(fixed);
  });

  it('gives a case without a script no entries', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'shipfox-eval-scripted-'));
    temporaryDirectories.push(directory);

    expect(await loadScriptedEntries(join(directory, 'scripted.yaml'))).toBeUndefined();
  });

  it('reads a script from YAML', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'shipfox-eval-scripted-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'scripted.yaml');
    await writeFile(
      path,
      '- match: {prompt_contains: Implement task-1}\n  replies:\n    - tool: set_output\n      args: {key: status, value: implemented}\n',
    );

    expect(await loadScriptedEntries(path)).toEqual([
      {
        match: {prompt_contains: 'Implement task-1'},
        replies: [{tool: 'set_output', args: {key: 'status', value: 'implemented'}}],
      },
    ]);
  });

  it('discovers the feedback-loop case with its script', async () => {
    const cases = await discoverCases(
      fileURLToPath(new URL('../cases/templates/', import.meta.url)),
      {filter: 'ticket-to-pr/feedback-loop'},
    );

    expect(cases.map((entry) => entry.script?.map((script) => script.match))).toEqual([
      [
        {prompt_contains: 'Rename the flag to --format json'},
        {prompt_contains: 'Post the replies below'},
        {prompt_contains: 'Implement task-1: Add a --json flag to the report command'},
      ],
    ]);
  });
});
