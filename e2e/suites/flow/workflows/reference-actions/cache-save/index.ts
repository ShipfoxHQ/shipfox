import {defineAction} from '@shipfox/actions';

type Inputs = {
  paths: string;
  key: string;
  scope: string;
};

export default defineAction<Inputs>(async ({inputs, cache, log}) => {
  // A runner older than the cache has no ctx.cache. The cache is best effort, so nothing is saved.
  if (cache === undefined) {
    log.warn('This runner has no cache support. Update the runner to use the cache.');
    return {saved: false};
  }

  const result = await cache.save({
    paths: lines(inputs.paths),
    key: inputs.key,
    scope: inputs.scope,
  });
  if (result.saved) log.info(`Saved ${inputs.key}`);
  else log.info(`Nothing saved for ${inputs.key}: ${result.reason ?? 'unknown'}`);
  return {saved: result.saved};
});

function lines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}
