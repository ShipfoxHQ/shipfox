import {readdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {type RegistryBump, registryBumpSchema} from '@shipfox/registry-format';
import {parse as parseYaml} from 'yaml';
import {z} from 'zod';
import {maxBump} from './bump.js';

const emptyChangesetPattern = /^---\r?\n---/;
const frontmatterPattern = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const releasesSchema = z.record(z.string(), registryBumpSchema);

export interface PendingChangeset {
  file: string;
  /** The workspace packages the changeset bumps, with the bump of each. */
  releases: Record<string, RegistryBump>;
}

export function parseChangeset({file, text}: {file: string; text: string}): PendingChangeset {
  // An empty changeset is `---\n---`, which has no release lines.
  const frontmatter = emptyChangesetPattern.test(text) ? '' : frontmatterPattern.exec(text)?.[1];
  if (frontmatter === undefined) throw new Error(`${file} has no changeset frontmatter`);
  const releases = releasesSchema.safeParse(parseYaml(frontmatter) ?? {});
  if (!releases.success) {
    throw new Error(`${file} has an invalid release: ${z.prettifyError(releases.error)}`);
  }
  return {file, releases: releases.data};
}

export async function readPendingChangesets(directory: string): Promise<PendingChangeset[]> {
  const files = (await readdir(directory))
    .filter((file) => file.endsWith('.md') && file !== 'README.md')
    .sort();
  return Promise.all(
    files.map(async (file) =>
      parseChangeset({file, text: await readFile(join(directory, file), 'utf8')}),
    ),
  );
}

/** The highest pending bump for each workspace package. */
export function pendingBumps(changesets: readonly PendingChangeset[]): Map<string, RegistryBump> {
  const bumps = new Map<string, RegistryBump>();
  for (const {releases} of changesets) {
    for (const [name, bump] of Object.entries(releases)) {
      const current = bumps.get(name);
      bumps.set(name, current === undefined ? bump : maxBump(current, bump));
    }
  }
  return bumps;
}
