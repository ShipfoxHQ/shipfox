import type {ClientFeature} from '#contract.js';
import {validateProjectDock, validateProviderIds} from './validate-providers.js';

const duplicateProviderMessage = /flags.*shipfox\.one.*acme\.two/u;

describe('validateProviderIds', () => {
  test('names an id and both features for duplicate providers', () => {
    expect(() =>
      validateProviderIds([
        {id: 'shipfox.one', providers: [{id: 'flags', Component: () => null}]},
        {id: 'acme.two', providers: [{id: 'flags', Component: () => null}]},
      ]),
    ).toThrow(duplicateProviderMessage);
  });

  test.each([
    'theme',
    'tooltip',
    'query-client',
    'jotai-store',
    'auth',
    'router',
    'toaster',
  ])('rejects reserved provider id %s', (id) => {
    const features: ClientFeature[] = [
      {id: 'acme.feature', providers: [{id, Component: () => null}]},
    ];

    expect(() => validateProviderIds(features)).toThrow(new RegExp(`${id}.*acme\\.feature`, 'u'));
  });
});

describe('validateProjectDock', () => {
  test('accepts one contribution', () => {
    expect(() =>
      validateProjectDock([
        {id: 'shipfox.one', projectDock: {load: async () => ({default: () => null})}},
        {id: 'acme.two'},
      ]),
    ).not.toThrow();
  });

  test('names both features when two contribute a dock', () => {
    expect(() =>
      validateProjectDock([
        {id: 'shipfox.one', projectDock: {load: async () => ({default: () => null})}},
        {id: 'acme.two', projectDock: {load: async () => ({default: () => null})}},
      ]),
    ).toThrow('Project dock is contributed by both features "shipfox.one" and "acme.two".');
  });
});
