import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, beforeAll, describe, expect, it} from '@shipfox/vitest/vi';
import {shippedTemplateLoader} from '@shipfox/workflow-templates';
import {checkTemplateCoverage} from './coverage.js';
import {type DiscoveredCase, discoverCases} from './discovery.js';

const casesRoot = fileURLToPath(new URL('../cases/templates/', import.meta.url));
const claim = 'Pushes a branch and opens a task pull request, as a draft by default.';
const unreadablePattern = /behaviors\.yaml: cases\.0\.proves/u;
const temporaryDirectories: string[] = [];

let cases: DiscoveredCase[];

beforeAll(async () => {
  cases = await discoverCases(casesRoot);
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, {recursive: true})),
  );
});

function check(entries: readonly DiscoveredCase[], root = casesRoot) {
  return checkTemplateCoverage({casesRoot: root, loader: shippedTemplateLoader, cases: entries});
}

function withoutCovers(line: string): DiscoveredCase[] {
  return cases.map((entry) => ({
    ...entry,
    definition: {
      ...entry.definition,
      covers: entry.definition.covers.filter((cover) => cover !== line),
    },
  }));
}

describe('template coverage', () => {
  it('backs every claim and required behavior of the shipped templates', async () => {
    const coverage = await check(cases);

    expect(coverage.problems).toEqual([]);
  });

  it('reports templates without a behaviors.yaml as pending, not failed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'shipfox-eval-behaviors-'));
    temporaryDirectories.push(root);
    await mkdir(join(root, 'ticket-to-pr'));
    await writeFile(
      join(root, 'ticket-to-pr', 'behaviors.yaml'),
      'cases:\n  - case: one-shot\n    proves: Ends after the pull request opens.\n',
    );

    const coverage = await check(cases, root);

    expect(coverage.pending).toContain('slack-dispatcher');
    expect(coverage.pending).not.toContain('ticket-to-pr');
  });

  it('fails when a required ticket-to-pr case is removed', async () => {
    const coverage = await check(cases.filter((entry) => entry.id !== 'ticket-to-pr/one-shot'));

    expect(coverage.problems).toContain('ticket-to-pr: required case "one-shot" does not exist');
  });

  it('fails when a required case no longer runs in scripted mode', async () => {
    const live = cases.map((entry) =>
      entry.id === 'ticket-to-pr/one-shot'
        ? {...entry, definition: {...entry.definition, modes: ['live' as const]}}
        : entry,
    );

    const coverage = await check(live);

    expect(coverage.problems).toContain(
      'ticket-to-pr: required case "one-shot" exists but is not a scripted case of shipfox/ticket-to-pr',
    );
  });

  it('fails when no scripted case lists a claim in covers', async () => {
    const coverage = await check(withoutCovers(claim));

    expect(coverage.problems).toContain(
      `ticket-to-pr: no scripted case lists the write "${claim}" in covers`,
    );
  });

  it('does not count a live-only case as citing a claim', async () => {
    const liveOnly = cases.map((entry) =>
      entry.definition.template === 'shipfox/ticket-to-pr'
        ? {...entry, definition: {...entry.definition, modes: ['live' as const]}}
        : entry,
    );

    const coverage = await check(liveOnly);

    expect(coverage.problems).toContain(
      `ticket-to-pr: no scripted case lists the write "${claim}" in covers`,
    );
  });

  it('reports the field that makes a behaviors.yaml unreadable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'shipfox-eval-behaviors-'));
    temporaryDirectories.push(root);
    await mkdir(join(root, 'ticket-to-pr'));
    await writeFile(
      join(root, 'ticket-to-pr', 'behaviors.yaml'),
      'cases:\n  - case: feedback-loop\n    proves: ""\n',
    );

    await expect(check([], root)).rejects.toThrow(unreadablePattern);
  });
});
