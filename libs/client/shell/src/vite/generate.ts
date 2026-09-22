import type {ComposedLayout, ComposedRoute} from '#compose/compose-routes.js';
import type {NavTabEntry, RouteParentId, SettingsSectionEntry} from '#contract.js';
import {routePathForParent} from '#runtime/anchor-paths.js';

const identifierSeparator = /[^a-zA-Z0-9]+/u;
const leadingDigit = /^\d/u;
const extension = /\.[^.]+$/u;

export interface GenerateAppModuleOptions {
  layouts?: readonly ComposedLayout[];
  routes: readonly ComposedRoute[];
  navigation: readonly NavTabEntry[];
  settingsSections: readonly SettingsSectionEntry[];
}

function literal(value: unknown): string {
  return JSON.stringify(value, undefined, 2);
}

function indentedLiteral(value: unknown, indentation: number): string {
  return literal(value).replaceAll('\n', `\n${' '.repeat(indentation)}`);
}

function isShellAnchor(parent: RouteParentId): boolean {
  return [
    'root',
    'workspaceLayout',
    'projectLayout',
    'workspaceSettings',
    'projectSettings',
  ].includes(parent);
}

function orderedLayouts(layouts: readonly ComposedLayout[]): ComposedLayout[] {
  const byId = new Map(layouts.map((layout) => [layout.id, layout]));
  const ordered: ComposedLayout[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(layout: ComposedLayout): void {
    if (visited.has(layout.id)) return;
    if (!isShellAnchor(layout.parent)) {
      if (visiting.has(layout.id)) {
        throw new Error(`Layout "${layout.id}" has a cyclic parent reference.`);
      }
      const parent = byId.get(layout.parent);
      if (!parent) {
        throw new Error(`Layout "${layout.id}" targets missing layout parent "${layout.parent}".`);
      }
      visiting.add(layout.id);
      visit(parent);
      visiting.delete(layout.id);
    }
    visited.add(layout.id);
    ordered.push(layout);
  }

  for (const layout of layouts) visit(layout);
  return ordered;
}

function identifier(value: string): string {
  const words = value.split(identifierSeparator).filter(Boolean);
  const name = words
    .map((word, index) => {
      if (index === 0) return `${word[0]?.toLowerCase()}${word.slice(1)}`;
      return `${word[0]?.toUpperCase()}${word.slice(1)}`;
    })
    .join('');
  if (!name) return 'unnamed';
  return leadingDigit.test(name) ? `route${name[0]?.toUpperCase()}${name.slice(1)}` : name;
}

function routeImplementationName(impl: string): string {
  const specifier = impl.split('?')[0] ?? impl;
  const basename = specifier.split('/').at(-1) ?? specifier;
  return identifier(basename.replace(extension, ''));
}

function routePathName(route: ComposedRoute, layoutPaths: ReadonlyMap<string, string>): string {
  const parent = route.parent.endsWith('Layout')
    ? route.parent.slice(0, -'Layout'.length)
    : route.parent;
  const path = routePathForParent(route.parent, route.path, layoutPaths);
  return identifier(`${parent}/${path === '/' ? 'index' : path}`);
}

function routeIdentifiers(
  routes: readonly ComposedRoute[],
  layoutPaths: ReadonlyMap<string, string>,
): ReadonlyMap<ComposedRoute, string> {
  const implementationNames = routes.map((route) => routeImplementationName(route.impl));
  const implementationNameCounts = new Map<string, number>();
  for (const name of implementationNames) {
    implementationNameCounts.set(name, (implementationNameCounts.get(name) ?? 0) + 1);
  }

  const pathQualifiedNames = routes.map((route, index) => {
    const implementationName = implementationNames[index] ?? 'unnamed';
    return implementationNameCounts.get(implementationName) === 1
      ? implementationName
      : routePathName(route, layoutPaths);
  });
  const pathQualifiedNameCounts = new Map<string, number>();
  for (const name of pathQualifiedNames) {
    pathQualifiedNameCounts.set(name, (pathQualifiedNameCounts.get(name) ?? 0) + 1);
  }

  return new Map(
    routes.map((route, index) => {
      const name = pathQualifiedNames[index] ?? 'unnamed';
      const uniqueName = pathQualifiedNameCounts.get(name) === 1 ? name : `${name}${index}`;
      return [route, `${uniqueName}Route`];
    }),
  );
}

function childRouteNames(
  routes: readonly ComposedRoute[],
  names: ReadonlyMap<ComposedRoute, string>,
  parent: RouteParentId,
): string {
  return routes
    .filter((route) => route.parent === parent)
    .map((route) => names.get(route))
    .join(', ');
}

function layoutTreeNames(layouts: readonly ComposedLayout[], parent: RouteParentId): string[] {
  return layouts
    .map((layout, index) => ({layout, index}))
    .filter(({layout}) => layout.parent === parent)
    .map(({index}) => `layout${index}Tree`);
}

function parentExpression(
  parent: RouteParentId,
  layoutIndexes: ReadonlyMap<string, number>,
): string {
  if (parent === 'root') return 'skeleton.rootRoute';
  if (isShellAnchor(parent)) return `skeleton.${parent}`;
  const index = layoutIndexes.get(parent);
  if (index === undefined) throw new Error(`Missing generated layout parent "${parent}".`);
  return `layout${index}`;
}

export function generateAppModule({
  layouts = [],
  routes,
  navigation,
  settingsSections,
}: GenerateAppModuleOptions): string {
  const generatedLayouts = orderedLayouts(layouts);
  const layoutIndexes = new Map(generatedLayouts.map((layout, index) => [layout.id, index]));
  const layoutPaths = new Map(generatedLayouts.map((layout) => [layout.id, layout.path]));
  const names = routeIdentifiers(routes, layoutPaths);
  const imports = [
    ...generatedLayouts.map(
      (layout, index) => `import * as layout${index}Module from ${literal(layout.impl)};`,
    ),
    ...routes.map((route) => `import * as ${names.get(route)}Module from ${literal(route.impl)};`),
  ].join('\n');
  const layoutDeclarations = generatedLayouts
    .map(
      (layout, index) => `const layout${index} = createRoute({
  getParentRoute: () => ${parentExpression(layout.parent, layoutIndexes)},
  path: ${literal(routePathForParent(layout.parent, layout.path, layoutPaths))},
  ...routeOptions(layout${index}Module.default, ${literal(layout.impl)}, ${literal(layout.path)}),
});`,
    )
    .join('\n\n');
  const routeDeclarations = routes
    .map(
      (route) => `const ${names.get(route)} = createRoute({
  getParentRoute: () => ${parentExpression(route.parent, layoutIndexes)},
  path: ${literal(routePathForParent(route.parent, route.path, layoutPaths))},
  ...routeOptions(${names.get(route)}Module.default, ${literal(route.impl)}, ${literal(route.path)}),
});`,
    )
    .join('\n\n');
  const layoutTreeDeclarations = generatedLayouts
    .map((layout, index) => ({layout, index}))
    .reverse()
    .map(({layout, index}) => {
      const routeChildren = childRouteNames(routes, names, layout.id);
      const children = [routeChildren, ...layoutTreeNames(generatedLayouts, layout.id)]
        .filter(Boolean)
        .join(',\n  ');
      return `const layout${index}Tree = layout${index}.addChildren([${children}]);`;
    })
    .join('\n');
  const declarations = [layoutDeclarations, routeDeclarations, layoutTreeDeclarations]
    .filter(Boolean)
    .join('\n\n');
  const rootRoutes = childRouteNames(routes, names, 'root');
  const rootChildren = [rootRoutes, ...layoutTreeNames(generatedLayouts, 'root'), 'workspaceLayout']
    .filter(Boolean)
    .join(',\n  ');
  const projectChildren = [
    childRouteNames(routes, names, 'projectLayout'),
    ...layoutTreeNames(generatedLayouts, 'projectLayout'),
    'projectSettings',
  ]
    .filter(Boolean)
    .join(',\n  ');
  const workspaceSettingsChildren = [
    childRouteNames(routes, names, 'workspaceSettings'),
    ...layoutTreeNames(generatedLayouts, 'workspaceSettings'),
  ]
    .filter(Boolean)
    .join(',\n  ');
  const projectSettingsChildren = [
    childRouteNames(routes, names, 'projectSettings'),
    ...layoutTreeNames(generatedLayouts, 'projectSettings'),
  ]
    .filter(Boolean)
    .join(',\n  ');
  const workspaceChildren = [
    childRouteNames(routes, names, 'workspaceLayout'),
    ...layoutTreeNames(generatedLayouts, 'workspaceLayout'),
    'projectLayout',
    'workspaceSettings',
  ]
    .filter(Boolean)
    .join(',\n  ');

  return `// GENERATED by @shipfox/client-shell/vite. Do not edit.
// biome-ignore-all format: generated code has stable, reviewable output.
// biome-ignore-all assist/source/organizeImports: generated imports follow route order.
import {createRoute, createRouter} from '@tanstack/react-router';
import {assertRouteImplFrame, buildAnchorSkeleton, parseAppSearch, stringifyAppSearch, type RouteImpl, type RouterContext} from '@shipfox/client-shell/runtime';
${imports}

function routeOptions<T extends RouteImpl>(routeImpl: T, impl: string, path: string): T['options'] {
  assertRouteImplFrame(routeImpl, impl, path);
  return routeImpl.options;
}

const skeleton = buildAnchorSkeleton({
  navigation: ${indentedLiteral(navigation, 2)},
  settingsSections: ${indentedLiteral(settingsSections, 2)},
});

${declarations}

const projectSettings = skeleton.projectSettings.addChildren([${projectSettingsChildren}]);
const projectLayout = skeleton.projectLayout.addChildren([${projectChildren}]);
const workspaceSettings = skeleton.workspaceSettings.addChildren([${workspaceSettingsChildren}]);
const workspaceLayout = skeleton.workspaceLayout.addChildren([
  ${workspaceChildren},
]);

export const routeTree = skeleton.rootRoute.addChildren([
  ${rootChildren},
]);

export const router = createRouter({
  routeTree,
  context: {auth: undefined, queryClient: undefined} satisfies RouterContext,
  scrollRestoration: true,
  parseSearch: parseAppSearch,
  stringifySearch: stringifyAppSearch,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
`;
}
