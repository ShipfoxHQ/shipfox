type FindTypeaheadMatchParams = {
  names: readonly string[];
  from: number;
  query: string;
};

/**
 * Returns the index of the node a typeahead query lands on, or `undefined` when
 * nothing matches. The search is case-insensitive and wraps past the last name.
 *
 * Repeating one character cycles through the names that start with it, so `w`,
 * `w`, `w` steps through three matches. A longer query starts on the current node
 * so that typing further doesn't move away from a node that still matches.
 */
export function findTypeaheadMatch({
  names,
  from,
  query,
}: FindTypeaheadMatchParams): number | undefined {
  const normalizedQuery = query.toLowerCase();
  const [firstCharacter = ''] = normalizedQuery;
  const isRepeatedCharacter = [...normalizedQuery].every(
    (character) => character === firstCharacter,
  );
  const search = isRepeatedCharacter ? firstCharacter : normalizedQuery;
  const start = isRepeatedCharacter ? from + 1 : from;

  for (let offset = 0; offset < names.length; offset++) {
    const index = (start + offset) % names.length;
    if (names[index]?.toLowerCase().startsWith(search)) return index;
  }
  return undefined;
}
