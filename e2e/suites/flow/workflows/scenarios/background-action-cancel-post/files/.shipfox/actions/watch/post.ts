import {defineAction} from '@shipfox/actions';

export default defineAction(({state, context, log}) => {
  if (context.phase !== 'post') throw new Error(`Expected the post phase, got ${context.phase}.`);
  log.info(`post watched=${state.get('watched') ?? '<missing>'}`);
  return undefined;
});
