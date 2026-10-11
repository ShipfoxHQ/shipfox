import {existsSync, writeFileSync} from 'node:fs';
import {defineAction} from '@shipfox/actions';

const MARKER = '.publish-failed-once';

export default defineAction(({setOutput}) => {
  if (existsSync(MARKER)) {
    setOutput('failure_kind', 'fatal');
    throw new Error('publish failed fatally');
  }

  writeFileSync(MARKER, 'failed');
  setOutput('failure_kind', 'transient');
  throw new Error('publish failed transiently');
});
