import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {composeRoutes} from '#compose/compose-routes.js';
import {navigationEntries, settingsEntries} from '#runtime/registries.js';
import {features} from '#test/fixtures/features.js';
import {generateAppModule} from './generate.js';

const goldenFile = fileURLToPath(
  new URL('../../test/typecheck/shipfox-app.gen.ts', import.meta.url),
);

describe('generateAppModule', () => {
  test('matches the checked composition fixture', async () => {
    const generated = generateAppModule({
      routes: composeRoutes(features),
      navigation: navigationEntries(features),
      settingsSections: settingsEntries(features),
    });

    await expect(readFile(goldenFile, 'utf8')).resolves.toBe(generated);
  });
});
