import {transformPlaywright} from '@storybook/test-runner';
import {transform as swcTransform} from '@swc/core';

async function processAsync(src, filename) {
  const csfTest = await transformPlaywright(src, filename);
  const result = await swcTransform(csfTest, {
    filename,
    swcrc: false,
    isModule: true,
    module: {type: 'es6'},
    jsc: {
      parser: {syntax: 'typescript', tsx: true},
      target: 'es2022',
      transform: {react: {runtime: 'automatic'}},
    },
  });
  return {code: result ? result.code : src};
}

export default {processAsync};
