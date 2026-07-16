import {mkdtemp, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {evaluateFeatures, invalidateFeatures} from './evaluate-features.js';

describe('evaluateFeatures', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'shipfox-client-shell-vite-'));
  });

  afterEach(async () => {
    await rm(directory, {recursive: true, force: true});
  });

  test('returns dependencies that were cached before the manifest reload', async () => {
    const features = join(directory, 'features.ts');
    const contribution = join(directory, 'contribution.ts');
    await writeFile(
      features,
      `import {feature} from './contribution.ts';
export const features = [feature];`,
    );
    await writeFile(contribution, `export const feature = {id: 'acme.projects'};`);

    await evaluateFeatures(features);
    invalidateFeatures([await realpath(features)]);

    const evaluated = await evaluateFeatures(features);

    expect(evaluated.loadedFiles).toContain(await realpath(contribution));
  });
});
