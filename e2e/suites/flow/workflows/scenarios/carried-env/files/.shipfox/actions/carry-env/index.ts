import {appendFileSync, chmodSync, mkdirSync, writeFileSync} from 'node:fs';
import {delimiter, join} from 'node:path';
import {defineAction} from '@shipfox/actions';

export default defineAction(({log}) => {
  const workspace = process.env.SHIPFOX_WORKSPACE ?? '';
  if (process.env.SEED !== 'from-seed') throw new Error(`SEED is ${process.env.SEED}`);
  // The step env wins over the carried value.
  if (process.env.OVERRIDDEN !== 'from-step') {
    throw new Error(`OVERRIDDEN is ${process.env.OVERRIDDEN}`);
  }
  if (!(process.env.PATH ?? '').split(delimiter).includes(join(workspace, 'seed-bin'))) {
    throw new Error('The carried directory is not on PATH');
  }
  log.info('action saw the carried env');

  mkdirSync(join(workspace, 'action-bin'), {recursive: true});
  const tool = join(workspace, 'action-bin', 'action-tool');
  writeFileSync(tool, '#!/bin/sh\necho "action-tool ran"\n');
  chmodSync(tool, 0o755);
  appendFileSync(process.env.SHIPFOX_ENV ?? '', 'ACTION_VAR=from-action\n');
  appendFileSync(process.env.SHIPFOX_PATH ?? '', `${join(workspace, 'action-bin')}\n`);
  throw new Error('failing after writing the carried env');
});
