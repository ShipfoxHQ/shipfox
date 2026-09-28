import {createHash} from 'node:crypto';
import {defineAction} from '@shipfox/actions';

// SHA-256 of the seeded secret, so the value itself stays out of the repository.
const EXPECTED_SHA256 = '9f05b6a9784acd5239146674a9d0b824823b1e2c0441f826f5c6b284ac4c380f';

export default defineAction<{token: string}>(({inputs, log}) => {
  if (createHash('sha256').update(inputs.token).digest('hex') !== EXPECTED_SHA256) {
    throw new Error('The secret input did not reach the action.');
  }
  log.info(`token=${inputs.token}`);
  return undefined;
});
