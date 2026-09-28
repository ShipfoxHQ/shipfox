import {defineAction} from '@shipfox/actions';

export default defineAction<{mode: 'throw' | 'exit'}>(({inputs, log}) => {
  if (inputs.mode === 'throw') throw new Error('handler threw on purpose');

  log.info('exiting with code 0 before the handler settles');
  process.exit(0);
});
