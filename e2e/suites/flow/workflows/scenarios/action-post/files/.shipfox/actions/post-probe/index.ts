import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {defineAction} from '@shipfox/actions';

export default defineAction(({state, addPath}) => {
  state.set('marker', 'from-main');
  mkdirSync('post-probe-bin', {recursive: true});
  addPath(resolve('post-probe-bin'));
});
