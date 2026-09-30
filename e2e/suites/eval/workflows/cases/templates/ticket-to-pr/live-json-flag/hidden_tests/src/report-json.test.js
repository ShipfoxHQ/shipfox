import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {test} from 'node:test';

const cli = new URL('./cli.js', import.meta.url);

test('prints the rows as a JSON array with --json', () => {
  const output = execFileSync(process.execPath, [cli.pathname, '--json'], {encoding: 'utf8'});

  assert.deepEqual(JSON.parse(output), [
    {name: 'open', total: 3},
    {name: 'closed', total: 5},
  ]);
});

test('still prints text without --json', () => {
  const output = execFileSync(process.execPath, [cli.pathname], {encoding: 'utf8'});

  assert.equal(output, 'open: 3\nclosed: 5\n');
});
