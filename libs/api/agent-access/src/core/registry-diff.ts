import {isDeepStrictEqual} from 'node:util';
import {createTwoFilesPatch} from 'diff';

const utf8Encoder = new TextEncoder();

export interface DeclarationChanges {
  added: Record<string, unknown>;
  removed: Record<string, unknown>;
  changed: Record<string, {from: unknown; to: unknown}>;
}

/** Compares two name-keyed declaration records, such as an action's inputs. */
export function diffDeclarations(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): DeclarationChanges {
  const beforeEntries = new Map(Object.entries(before));
  const afterEntries = new Map(Object.entries(after));
  return {
    added: Object.fromEntries([...afterEntries].filter(([name]) => !beforeEntries.has(name))),
    removed: Object.fromEntries([...beforeEntries].filter(([name]) => !afterEntries.has(name))),
    changed: Object.fromEntries(
      [...afterEntries]
        .filter(([name, value]) => {
          const earlier = beforeEntries.get(name);
          return beforeEntries.has(name) && !isDeepStrictEqual(earlier, value);
        })
        .map(([name, value]) => [name, {from: beforeEntries.get(name), to: value}]),
    ),
  };
}

export interface SourceFile {
  path: string;
  content: string;
}

export interface SourceFileChange {
  path: string;
  /** `undefined` when the file is new. */
  before: string | undefined;
  /** `undefined` when the file was removed. */
  after: string | undefined;
}

/** The files that differ between two source archives, ordered by path. */
export function changedSourceFiles(
  before: readonly SourceFile[],
  after: readonly SourceFile[],
): SourceFileChange[] {
  const beforeByPath = new Map(before.map((file) => [file.path, file.content]));
  const afterByPath = new Map(after.map((file) => [file.path, file.content]));
  return [...new Set([...beforeByPath.keys(), ...afterByPath.keys()])]
    .sort()
    .map((path) => ({path, before: beforeByPath.get(path), after: afterByPath.get(path)}))
    .filter(({before: earlier, after: later}) => earlier !== later);
}

// Bounds the diff cost of a file that changed almost everywhere; such a file gets a replacement hunk.
const MAX_EDIT_LENGTH = 2000;

export function sourceFilePatch({path, before, after}: SourceFileChange): string {
  const oldName = before === undefined ? '/dev/null' : `a/${path}`;
  const newName = after === undefined ? '/dev/null' : `b/${path}`;
  return (
    createTwoFilesPatch(oldName, newName, before ?? '', after ?? '', undefined, undefined, {
      context: 3,
      maxEditLength: MAX_EDIT_LENGTH,
    }) ?? replacementPatch({oldName, newName, before: before ?? '', after: after ?? ''})
  );
}

function replacementPatch(params: {
  oldName: string;
  newName: string;
  before: string;
  after: string;
}): string {
  const removed = splitLines(params.before);
  const added = splitLines(params.after);
  return [
    `--- ${params.oldName}`,
    `+++ ${params.newName}`,
    `@@ ${hunkRange('-', removed.length)} ${hunkRange('+', added.length)} @@`,
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`),
    '',
  ].join('\n');
}

function hunkRange(sign: '-' | '+', count: number): string {
  return count === 0 ? `${sign}0,0` : `${sign}1,${count}`;
}

function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

export interface SourceDiffPage {
  text: string;
  /** Index of the first file of the next page, or `null` after the last file. */
  next: number | null;
}

/**
 * Fills one page with whole file patches. The budget counts the JSON-escaped size of the text,
 * so a page never outgrows the response ceiling. A file that alone exceeds the budget is cut and
 * marked, so paging always advances.
 */
export function pageSourceDiff(params: {
  changes: readonly SourceFileChange[];
  start: number;
  maxBytes: number;
}): SourceDiffPage {
  const {changes, start, maxBytes} = params;
  let text = '';
  let used = 0;
  let index = start;
  for (; index < changes.length; index += 1) {
    const change = changes[index];
    if (change === undefined) break;
    const patch = sourceFilePatch(change);
    const size = jsonStringBytes(patch);
    if (used + size <= maxBytes) {
      text += patch;
      used += size;
      continue;
    }
    if (used === 0) {
      const marker = `\n\\ Patch of ${change.path} cut at the page limit\n`;
      text = truncateToJsonBytes(patch, maxBytes - jsonStringBytes(marker)) + marker;
      index += 1;
    }
    break;
  }
  return {text, next: index < changes.length ? index : null};
}

function jsonStringBytes(value: string): number {
  return utf8Encoder.encode(JSON.stringify(value)).byteLength - 2;
}

function truncateToJsonBytes(value: string, maxBytes: number): string {
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (jsonStringBytes(value.slice(0, middle)) <= maxBytes) low = middle;
    else high = middle - 1;
  }
  const lastCode = value.charCodeAt(low - 1);
  // A cut between the halves of a surrogate pair would leave an unpaired surrogate.
  return value.slice(0, lastCode >= 0xd800 && lastCode <= 0xdbff ? low - 1 : low);
}
