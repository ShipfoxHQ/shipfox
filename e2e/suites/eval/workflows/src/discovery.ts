import {readdir} from 'node:fs/promises';
import {join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadTemplateCase, type TemplateCase} from './schema.js';

export interface DiscoveredCase {
  id: string;
  directory: string;
  definitionPath: string;
  definition: TemplateCase;
}

const defaultCasesRoot = fileURLToPath(new URL('../cases/templates/', import.meta.url));

function globToRegExp(pattern: string): RegExp {
  let expression = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index] ?? '';
    if (character === '*') {
      if (pattern[index + 1] === '*') {
        expression += '.*';
        index += 1;
      } else {
        expression += '[^/]*';
      }
      continue;
    }
    expression += character.replace(/[|\\{}()[\]^$+?.]/gu, '\\$&');
  }
  return new RegExp(`${expression}$`, 'u');
}

function matchesCase(id: string, filter: string | undefined): boolean {
  if (!filter || filter === '*') return true;
  return globToRegExp(filter.replaceAll('\\', '/')).test(id);
}

async function findCaseDirectories(root: string): Promise<string[]> {
  const directories: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, {withFileTypes: true});
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const child = join(directory, entry.name);
      const childEntries = await readdir(child, {withFileTypes: true});
      if (
        childEntries.some((childEntry) => childEntry.isFile() && childEntry.name === 'case.yaml')
      ) {
        directories.push(child);
        continue;
      }
      await walk(child);
    }
  };

  await walk(root);
  return directories.sort();
}

/** Discovers and validates every template case below a case root. */
export async function discoverCases(
  root = defaultCasesRoot,
  options: {filter?: string} = {},
): Promise<DiscoveredCase[]> {
  const cases: DiscoveredCase[] = [];
  for (const directory of await findCaseDirectories(root)) {
    const id = relative(root, directory).split('\\').join('/');
    if (!matchesCase(id, options.filter)) continue;

    const definitionPath = join(directory, 'case.yaml');
    cases.push({
      id,
      directory,
      definitionPath,
      definition: await loadTemplateCase(definitionPath),
    });
  }
  return cases;
}

export function caseSupportsMode(templateCase: TemplateCase, mode: 'scripted' | 'live'): boolean {
  return templateCase.modes.includes(mode);
}
