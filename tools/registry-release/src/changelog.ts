const VERSION_HEADING = /^## \d+\.\d+\.\d+/;

/**
 * The body of the `## <version>` section of a Changesets `CHANGELOG.md`, or
 * `undefined` when the file has no such section or the section is empty. A
 * `## ` line that is not a version heading stays in the body.
 */
export function extractChangelogSection({
  changelog,
  version,
}: {
  changelog: string;
  version: string;
}): string | undefined {
  const lines = changelog.replaceAll('\r\n', '\n').split('\n');
  const start = lines.findIndex((line) => line.trimEnd() === `## ${version}`);
  if (start === -1) return undefined;
  const length = lines.slice(start + 1).findIndex((line) => VERSION_HEADING.test(line));
  const body = lines.slice(start + 1, length === -1 ? undefined : start + 1 + length);
  const section = body.join('\n').trim();
  return section === '' ? undefined : section;
}
