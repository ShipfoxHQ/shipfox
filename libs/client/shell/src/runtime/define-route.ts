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

export interface RouteImpl<O extends RouteImplOptions = RouteImplOptions> {
  readonly options: O;
  readonly [routeImplBrand]: true;
}

export function defineRoute<const O extends RouteImplOptions>(options: O): RouteImpl<O> {
  return {options, [routeImplBrand]: true};
}
