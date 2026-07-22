import {useParams, useSearch} from '@tanstack/react-router';

/**
 * Reads inputs at the dynamic feature-route boundary. Feature routes must immediately
 * validate the result and pass typed values to pages; Shell never interprets feature input.
 */
export function useRouteSearch<T>(parse: (search: Record<string, unknown>) => T): T {
  return parse(useSearch({strict: false}) as Record<string, unknown>);
}

/**
 * Reads path parameters at the dynamic feature-route boundary without making Shell
 * responsible for a feature's parameter contract.
 */
export function useRouteParams<T>(parse: (params: Record<string, unknown>) => T): T {
  return parse(useParams({strict: false}) as Record<string, unknown>);
}
