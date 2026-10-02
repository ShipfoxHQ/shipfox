import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from '@shipfox/vitest/vi';
import {loadContracts} from './contracts.js';

const unknownReferencePattern = /unknown reference \$fixtures\.linear\.issue\.identifier/u;
const targetPattern = /\$target\.linear\.missing_issue\.identifier is only for cases of kind/u;
const laterPattern = /\$steps\.later\.id reads a step that runs later/u;
const directoryPattern = /does not match its directory "slack"/u;
const providerPattern = /provider "jira" is not in sandbox\.yaml/u;
const yamlPattern = /could not parse YAML/u;

const sandbox = `
linear:
  connection: linear_sandbox
  fixtures:
    issue: {identifier: CON-1, uuid: 8e3b}
  targets:
    missing_issue: {kind: absent, identifier: CON-999999}
`;
const backlog = `
ceiling: 1
entries:
  - {tool: linear.save_issue, kind: write, issue: ENG-2816}
`;
const getIssue = `
provider: linear
modes: [real, fake]
steps:
  - tool: get_issue
    with: {id: $fixture.linear.issue.identifier}
    expect:
      shape: {id: string, team: {key: string}, labels: [{name: string}]}
      values: {id: $fixture.linear.issue.identifier}
`;

describe('loadContracts', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'shipfox-eval-contracts-'));
    await writeFixture('sandbox.yaml', sandbox);
    await writeFixture('backlog.yaml', backlog);
  });

  afterEach(async () => {
    await rm(root, {recursive: true, force: true});
  });

  async function writeFixture(name: string, source: string) {
    const path = join(root, name);
    await mkdir(dirname(path), {recursive: true});
    await writeFile(path, source);
  }

  it('loads the manifest, the backlog, cases, and exemptions', async () => {
    await writeFixture('linear/get-issue.yaml', getIssue);
    await writeFixture(
      'gitea/all.yaml',
      'provider: gitea\nexempt: {reason: No Gitea in staging.}\n',
    );

    const files = await loadContracts(root);

    expect(files.manifest.linear?.connection).toBe('linear_sandbox');
    expect(files.backlog.entries).toHaveLength(1);
    expect(files.cases.map(({id}) => id)).toEqual(['linear/get-issue']);
    expect(files.exemptions.map(({id}) => id)).toEqual(['gitea/all']);
  });

  it('rejects an unknown reference', async () => {
    await writeFixture(
      'linear/bad.yaml',
      getIssue.replace(
        '$fixture.linear.issue.identifier}\n    expect',
        '$fixtures.linear.issue.identifier}\n    expect',
      ),
    );

    await expect(loadContracts(root)).rejects.toThrow(unknownReferencePattern);
  });

  it('rejects a $target in a case that is not an error case', async () => {
    await writeFixture(
      'linear/bad.yaml',
      'provider: linear\nmodes: [real]\nsteps:\n  - tool: get_issue\n    with: {id: $target.linear.missing_issue.identifier}\n',
    );

    await expect(loadContracts(root)).rejects.toThrow(targetPattern);
  });

  it('rejects a $steps reference to a later step', async () => {
    await writeFixture(
      'linear/bad.yaml',
      [
        'provider: linear',
        'modes: [real]',
        'steps:',
        '  - tool: get_issue',
        '    with: {id: $steps.later.id}',
        '  - key: later',
        '    tool: save_issue',
      ].join('\n'),
    );

    await expect(loadContracts(root)).rejects.toThrow(laterPattern);
  });

  it('rejects a case in the wrong provider directory', async () => {
    await writeFixture('slack/get-issue.yaml', getIssue);

    await expect(loadContracts(root)).rejects.toThrow(directoryPattern);
  });

  it('rejects a case whose provider has no sandbox entry', async () => {
    await writeFixture(
      'jira/get-issue.yaml',
      getIssue.replace('provider: linear', 'provider: jira'),
    );

    await expect(loadContracts(root)).rejects.toThrow(providerPattern);
  });

  it('rejects a file that is not YAML', async () => {
    await writeFixture('linear/bad.yaml', 'steps: [');

    await expect(loadContracts(root)).rejects.toThrow(yamlPattern);
  });
});
