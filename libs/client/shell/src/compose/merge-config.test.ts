import {z} from 'zod';
import {mergeConfigShapes} from './merge-config.js';

const duplicateConfigMessage = /shared.*shipfox\.one.*acme\.two/u;

describe('mergeConfigShapes', () => {
  test('names the key and both features for independent duplicate schemas', () => {
    expect(() =>
      mergeConfigShapes([
        {id: 'shipfox.one', configShape: {shared: z.string()}},
        {id: 'acme.two', configShape: {shared: z.string()}},
      ]),
    ).toThrow(duplicateConfigMessage);
  });

  test('deduplicates the exact same schema instance', () => {
    const shared = z.string();

    expect(
      mergeConfigShapes([
        {id: 'shipfox.one', configShape: {shared}},
        {id: 'acme.two', configShape: {shared}},
      ]).shared,
    ).toBe(shared);
  });
});
