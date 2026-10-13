import {defineAction} from '@shipfox/actions';

type Inputs = {
  paths: string;
  key: string;
  key_files: string;
  restore_keys: string;
  scope: string;
  fallback_scopes: string;
  fail_on_miss: boolean;
};

export default defineAction<Inputs>(async ({inputs, cache, log}) => {
  let key = inputs.key;
  // A runner older than the cache has no ctx.cache. The cache is best effort, so that is a miss.
  if (cache === undefined) {
    log.warn('This runner has no cache support. Update the runner to use the cache.');
    if (inputs.fail_on_miss) throw new Error('Nothing was restored: the runner has no cache.');
    return {key, hit: false};
  }

  const keyFiles = lines(inputs.key_files);
  if (keyFiles.length > 0) key = `${key}-${await cache.hashFiles(keyFiles)}`;

  const restored = await cache.restore({
    paths: lines(inputs.paths),
    key,
    restoreKeys: lines(inputs.restore_keys),
    scope: inputs.scope,
    fallbackScopes: lines(inputs.fallback_scopes),
  });

  if (restored.matchedKey === undefined) {
    if (inputs.fail_on_miss) throw new Error(`Nothing was restored for the key ${key}.`);
    log.info(`Cache miss for ${key}`);
    return {key, hit: false};
  }
  log.info(`Restored ${restored.matchedKey} from the scope ${restored.matchedScope}`);
  return {
    key,
    hit: restored.hit,
    matched_key: restored.matchedKey,
    ...(restored.matchedScope === undefined ? {} : {matched_scope: restored.matchedScope}),
  };
});

function lines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}
