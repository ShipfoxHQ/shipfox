import {defineRoute, isRouteImpl} from './define-route.js';

describe('isRouteImpl', () => {
  test('accepts implementations created by defineRoute', () => {
    const route = defineRoute({component: () => null});

    expect(isRouteImpl(route)).toBe(true);
  });

  test('rejects a default component without a route implementation', () => {
    const component = () => null;

    expect(isRouteImpl(component)).toBe(false);
  });
});
