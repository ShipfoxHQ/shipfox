import {defineAction} from '@shipfox/actions';

export default defineAction(async ({inputs, cache, setOutput}) => {
  const paths = inputs.paths as string[];
  if (inputs.mode === 'hash') {
    setOutput('result', {hash: await cache.hashFiles(paths)});
  } else if (inputs.mode === 'save') {
    setOutput(
      'result',
      await cache.save({paths, key: inputs.key as string, scope: inputs.scope as string}),
    );
  } else {
    setOutput(
      'result',
      await cache.restore({
        paths,
        key: inputs.key as string,
        restoreKeys: inputs.restore_keys as string[],
        scope: inputs.scope as string,
        fallbackScopes: inputs.fallback_scopes as string[],
      }),
    );
  }
});
