import {type RegistryPackageKind, registryPackageKindSchema} from '@shipfox/registry-format';

// The catalog API refuses a longer search.
const QUERY_MAX_LENGTH = 100;

export interface CatalogFilters {
  kind?: RegistryPackageKind;
  query?: string;
}

/** The filters of a catalog URL. A value the page does not understand is ignored. */
export function catalogFilters(
  searchParams: Record<string, string | string[] | undefined>,
): CatalogFilters {
  const kind = registryPackageKindSchema.safeParse(first(searchParams.kind));
  const query = first(searchParams.q)?.trim().slice(0, QUERY_MAX_LENGTH);
  return {
    ...(kind.success ? {kind: kind.data} : {}),
    ...(query ? {query} : {}),
  };
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
