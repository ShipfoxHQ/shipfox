import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {reclaimAgentState} from '#core/reclaim-agent-state.js';

describe('reclaimAgentState', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'shipfox-reclaim-'));
    await mkdir(join(dir, 'nested'));
    await writeFile(join(dir, 'nested', 'session.jsonl'), '{}');
  });

  afterEach(async () => {
    await rm(dir, {recursive: true, force: true});
  });

  it('leaves files the runner owns alone, without sudo', async () => {
    await expect(reclaimAgentState(dir)).resolves.toBeUndefined();
  });

  it('does nothing for a directory that is gone', async () => {
    await rm(dir, {recursive: true});

    await expect(reclaimAgentState(dir)).resolves.toBeUndefined();
  });
});
