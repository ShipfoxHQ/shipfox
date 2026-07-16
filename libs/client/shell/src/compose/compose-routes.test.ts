import type {ClientFeature} from '#contract.js';
import {composeRoutes} from './compose-routes.js';

const base: ClientFeature = {
  id: 'shipfox.base',
  routes: [{path: '/projects', parent: 'root', impl: 'base'}],
};
const collisionMessage = /\/projects.*shipfox\.base.*acme\.insights/u;
const danglingOverrideMessage = /\/missing.*acme\.insights/u;
const competingOverridesMessage = /\/projects.*acme\.one.*acme\.two/u;

describe('composeRoutes', () => {
  test('appends a unique route and explicitly replaces an existing route', () => {
    const routes = composeRoutes([
      base,
      {
        id: 'acme.insights',
        routes: [{path: '/projects', parent: 'root', override: true, impl: 'override'}],
      },
      {id: 'acme.audit', routes: [{path: '/audit', parent: 'root', impl: 'audit'}]},
    ]);

    expect(routes).toEqual([
      {
        path: '/projects',
        parent: 'root',
        override: true,
        impl: 'override',
        featureId: 'acme.insights',
      },
      {path: '/audit', parent: 'root', impl: 'audit', featureId: 'acme.audit'},
    ]);
  });

  test('names the path and both features for a collision', () => {
    expect(() =>
      composeRoutes([
        base,
        {id: 'acme.insights', routes: [{path: '/projects', parent: 'root', impl: 'next'}]},
      ]),
    ).toThrow(collisionMessage);
  });

  test('names the path and feature for a dangling override', () => {
    expect(() =>
      composeRoutes([
        {
          id: 'acme.insights',
          routes: [{path: '/missing', parent: 'root', override: true, impl: 'next'}],
        },
      ]),
    ).toThrow(danglingOverrideMessage);
  });

  test('names the path and both features for competing overrides', () => {
    expect(() =>
      composeRoutes([
        base,
        {
          id: 'acme.one',
          routes: [{path: '/projects', parent: 'root', override: true, impl: 'one'}],
        },
        {
          id: 'acme.two',
          routes: [{path: '/projects', parent: 'root', override: true, impl: 'two'}],
        },
      ]),
    ).toThrow(competingOverridesMessage);
  });
});
