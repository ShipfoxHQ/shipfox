const nonStableIdPattern = /[^a-z0-9]+/g;
const edgeDashPattern = /^-+|-+$/g;

export function stableId(sourceName: string): string {
  const id = sourceName
    .trim()
    .toLowerCase()
    .replace(nonStableIdPattern, '-')
    .replace(edgeDashPattern, '');

  return id.length === 0 ? 'unnamed' : id;
}
