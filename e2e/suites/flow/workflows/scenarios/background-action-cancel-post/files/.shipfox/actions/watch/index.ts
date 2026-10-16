import {writeFileSync} from 'node:fs';
import {setTimeout} from 'node:timers/promises';
import {defineAction} from '@shipfox/actions';

export default defineAction(async ({state, signal}) => {
  state.set('watched', 'saved-before-cancel');
  writeFileSync('.watch-ready', '');
  // Runs until the cancel aborts the signal. The timeout only bounds a run whose cancel never comes.
  await setTimeout(600_000, undefined, {signal}).catch(() => undefined);
  return undefined;
});
