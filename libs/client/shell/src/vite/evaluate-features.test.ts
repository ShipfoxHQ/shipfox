import {mkdtemp, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {evaluateFeatures} from './evaluate-features.js';

const fixtureFeatures = fileURLToPath(new URL('../../test/fixtures/features.ts', import.meta.url));
const contractSource = fileURLToPath(new URL('../contract.ts', import.meta.url));

describe('evaluateFeatures', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'shipfox-client-shell-vite-'));
  });

  afterEach(async () => {
    await rm(directory, {recursive: true, force: true});
  });

  test('reloads dependencies and reports them as watched files', async () => {
    const features = join(directory, 'features.ts');
    const contribution = join(directory, 'contribution.ts');
    await writeFile(
      features,
      `import {feature} from './contribution.ts';
export const features = [feature];`,
    );
    await writeFile(contribution, `export const feature = {id: 'acme.projects'};`);

    await evaluateFeatures(features);
    await writeFile(contribution, `export const feature = {id: 'acme.reports'};`);

    const evaluated = await evaluateFeatures(features);

    expect(evaluated.features).toEqual([{id: 'acme.reports'}]);
    expect(evaluated.loadedFiles).toContain(await realpath(contribution));
  });

  test('reloads JSON dependencies and reports them as watched files', async () => {
    const features = join(directory, 'features.ts');
    const contribution = join(directory, 'contribution.json');
    await writeFile(
      features,
      `import feature from './contribution.json';
export const features = [feature];`,
    );
    await writeFile(contribution, JSON.stringify({id: 'acme.projects'}));

    await evaluateFeatures(features);
    await writeFile(contribution, JSON.stringify({id: 'acme.reports'}));

    const evaluated = await evaluateFeatures(features);

    expect(evaluated.features).toEqual([{id: 'acme.reports'}]);
    expect(evaluated.loadedFiles).toContain(await realpath(contribution));
  });

  test('evicts JSON dependencies after evaluation fails', async () => {
    const features = join(directory, 'features.ts');
    const contribution = join(directory, 'contribution.json');
    await writeFile(
      features,
      `import feature from './contribution.json';
throw new Error('fixture failure');
export const features = [feature];`,
    );
    await writeFile(contribution, JSON.stringify({id: 'acme.projects'}));

    const failedEvaluation = evaluateFeatures(features);
    await expect(failedEvaluation).rejects.toThrow('fixture failure');
    await writeFile(
      features,
      `import feature from './contribution.json';
export const features = [feature];`,
    );
    await writeFile(contribution, JSON.stringify({id: 'acme.reports'}));

    const evaluated = await evaluateFeatures(features);

    expect(evaluated.features).toEqual([{id: 'acme.reports'}]);
  });

  test('resolves package imports through the workspace source condition', async () => {
    const evaluated = await evaluateFeatures(fixtureFeatures);

    expect(evaluated.loadedFiles).toContain(await realpath(contractSource));
  });
});
