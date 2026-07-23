import {describe, expect, it} from '@shipfox/vitest/vitest';
import {
  storybookLinks,
  storybookRefs,
  storybooks,
  storybookTurboFilters,
} from '../preview-manifest.js';

describe('storybook preview manifest', () => {
  it('contains ten uniquely ordered Storybooks, including client-projects', () => {
    expect(storybooks).toHaveLength(10);
    expect(storybooks.map(({order}) => order)).toEqual(
      Array.from({length: 10}, (_, index) => index + 1),
    );
    expect(new Set(storybooks.map(({id}) => id)).size).toBe(storybooks.length);
    expect(storybooks.some(({id}) => id === 'client-projects')).toBe(true);
  });

  it('derives Composition refs and standalone links from the same entries', () => {
    expect(Object.keys(storybookRefs)).toEqual(storybooks.map(({id}) => id));
    expect(storybookLinks).toEqual(storybooks.map(({id, title, url}) => ({id, title, url})));
    expect(Object.values(storybookRefs)).toEqual(storybooks.map(({title, url}) => ({title, url})));
  });

  it('points each composed Storybook link at its static index document', () => {
    expect(storybooks.map(({url}) => url)).toEqual(storybooks.map(({path}) => `${path}index.html`));
  });

  it('derives Turbo package filters from the manifest', () => {
    expect(storybookTurboFilters).toEqual(storybooks.map(({package: packageName}) => packageName));
  });
});
