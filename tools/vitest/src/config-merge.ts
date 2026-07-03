import {join} from 'node:path';
import type {ResolveAlias} from './config-types.js';

const projectRootSlashImportPattern = /^#\/(.+)$/;
const projectRootImportPattern = /^#(?!test\/)(.+)$/;

export function withoutConditions(conditions: string[], excludedConditions: string[]): string[] {
  return conditions.filter(
    (condition) =>
      condition !== 'development' &&
      condition !== 'development|production' &&
      !excludedConditions.includes(condition),
  );
}

export function mergeConditions(
  existing: string[] | undefined,
  fallback: string[],
  excludedConditions: string[] = [],
): string[] {
  return Array.from(
    new Set([
      ...withoutConditions(existing ?? [], excludedConditions),
      ...withoutConditions(fallback, excludedConditions),
    ]),
  );
}

export function mergeExternalPackages(
  existing: string[] | true | undefined,
  packageNames: string[],
) {
  if (existing === true) return true;
  return Array.from(new Set([...(existing || []), ...packageNames]));
}

export function mergeInlineDeps(
  existing: (string | RegExp)[] | true | undefined,
  deps: Array<string | RegExp>,
) {
  if (existing === true) return true;
  return [...(existing || []), ...deps];
}

export function mergeStringList(existing: string[] | undefined, values: string[]): string[] {
  return Array.from(new Set([...(existing || []), ...values]));
}

function normalizeAlias(alias: ResolveAlias | undefined): Array<{
  find: string | RegExp;
  replacement: string;
}> {
  if (!alias) return [];
  if (Array.isArray(alias)) return alias;
  return Object.entries(alias).map(([find, replacement]) => ({find, replacement}));
}

export function mergeProjectSourceAliases(
  alias: ResolveAlias | undefined,
  projectRoot: string | undefined,
) {
  const existingAliases = normalizeAlias(alias);
  if (!projectRoot) return existingAliases;

  const projectSrc = join(projectRoot, 'src');
  return [
    {find: projectRootSlashImportPattern, replacement: `${projectSrc}/$1`},
    {find: projectRootImportPattern, replacement: `${projectSrc}/$1`},
    ...existingAliases,
  ];
}
