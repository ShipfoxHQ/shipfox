import {createRequire} from 'node:module';
import {defineAction} from '@shipfox/actions';

export default defineAction<{module: string}>(({inputs, log}) => {
  // The recipe rejects a computed `import()` or `require()`, but not this call, so the bundle
  // keeps a bare import like a dependency that loads a package by name at run time.
  createRequire(import.meta.url)(inputs.module);
  log.info(`imported ${inputs.module}`);
  return undefined;
});
