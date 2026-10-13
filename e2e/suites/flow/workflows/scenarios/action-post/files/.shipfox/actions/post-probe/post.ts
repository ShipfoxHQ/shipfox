import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {delimiter, resolve} from 'node:path';
import {defineAction} from '@shipfox/actions';

// SHA-256 of the seeded secrets, so the values stay out of the action source.
const TOKEN_SHA256 = 'a297504677d5e98afa11fc78b1650ef60edba42123eb9df308444b6361fa75f8';
const ENV_SHA256 = 'd6960b2950c2360e4894572447e0fec69c067fba284758f1dd05b93789a5bdaf';

function sha256(value: string | undefined): string {
  return createHash('sha256')
    .update(value ?? '')
    .digest('hex');
}

export default defineAction<{token: string; fail_post: string}>(({inputs, state, context, log}) => {
  if (context.phase !== 'post') throw new Error(`Expected the post phase, got ${context.phase}.`);
  if (state.get('marker') !== 'from-main') {
    throw new Error('The state of the main entry did not reach the post.');
  }
  if (sha256(inputs.token) !== TOKEN_SHA256) {
    throw new Error('The secret input did not reach the post.');
  }
  if (sha256(process.env.POST_ENV_SECRET) !== ENV_SHA256) {
    throw new Error('The secret env variable did not reach the post.');
  }
  const directories = (process.env.PATH ?? '').split(delimiter);
  if (!directories.includes(resolve('post-probe-bin'))) {
    throw new Error('The PATH export of the main entry did not reach the post.');
  }

  log.info(`post token=${inputs.token}`);
  log.info(`post env=${process.env.POST_ENV_SECRET}`);
  log.info(`post execution.failed=${context.execution?.failed} main=${context.main?.status}`);
  log.info('post path=ok');
  log.info(`post build-ran=${existsSync('.post-probe-build-ran')}`);
  if (inputs.fail_post === 'true') throw new Error('The post was asked to fail.');
  return undefined;
});
