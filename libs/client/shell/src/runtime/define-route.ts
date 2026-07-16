import type {ComponentType} from 'react';

export interface RouteImplOptions {
  component: ComponentType;
  loader?: unknown;
  validateSearch?: unknown;
  beforeLoad?: unknown;
  staticData?: unknown;
  pendingComponent?: ComponentType;
  errorComponent?: ComponentType;
}

const routeImplBrand = Symbol('routeImpl');

export interface RouteImpl {
  readonly options: RouteImplOptions;
  readonly [routeImplBrand]: true;
}

export function defineRoute(options: RouteImplOptions): RouteImpl {
  return {options, [routeImplBrand]: true};
}
