import {resolveDynamicRouteImpl} from './compose-client-app.js';

const missingRouteImplementationMessage = /must export a default RouteImpl or Route/u;

describe('resolveDynamicRouteImpl', () => {
  test('loads a default route implementation export', async () => {
    const implementation = await resolveDynamicRouteImpl('#test/default-route-impl.js');
    const {default: defaultRoute} = await import('#test/default-route-impl.js');

    expect(implementation).toBe(defaultRoute);
  });

  test('loads a named Route implementation export', async () => {
    const implementation = await resolveDynamicRouteImpl('#test/named-route-impl.js');
    const {Route} = await import('#test/named-route-impl.js');

    expect(implementation).toBe(Route);
  });

  test('rejects a module without a route implementation export', async () => {
    await expect(resolveDynamicRouteImpl('#test/not-route-impl.js')).rejects.toThrow(
      missingRouteImplementationMessage,
    );
  });
});
