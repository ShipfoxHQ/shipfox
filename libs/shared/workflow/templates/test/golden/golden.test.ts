import {readdirSync, readFileSync} from 'node:fs';
import {describe, expect, it} from '@shipfox/vitest/vi';
import {loadShippedTemplates, SUPPORTED_COMPOSITIONS} from '#index.js';
import {
  composeGoldenFiles,
  compositionDirectory,
  constructNames,
  loadFixtureTemplate,
  usedConstructs,
} from './corpus.js';

describe('golden corpus', () => {
  it.each(SUPPORTED_COMPOSITIONS)('reproduces composition %i byte for byte', (composition) => {
    const directory = compositionDirectory(composition);
    const stored = new Map(
      readdirSync(directory).map((name) => [name, readFileSync(new URL(name, directory), 'utf8')]),
    );

    const composed = composeGoldenFiles(composition);

    expect([...composed.keys()].sort()).toEqual([...stored.keys()].sort());
    for (const [name, content] of composed) {
      expect(content, name).toBe(stored.get(name));
    }
  });

  it('has a fixture that uses every composer behavior', () => {
    expect([...usedConstructs(loadFixtureTemplate())].sort()).toEqual([...constructNames].sort());
  });

  it('covers every composer behavior the shipped templates use', () => {
    const fixture = usedConstructs(loadFixtureTemplate());

    for (const template of loadShippedTemplates()) {
      const uncovered = [...usedConstructs(template)].filter((name) => !fixture.has(name));
      expect(uncovered, `${template.id} uses behaviors the fixture does not cover`).toEqual([]);
    }
  });
});
