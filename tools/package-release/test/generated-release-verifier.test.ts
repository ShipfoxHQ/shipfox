import assert from 'node:assert/strict';

import {
  type VerifyGeneratedReleaseOptions,
  verifyGeneratedRelease,
} from '../src/generated-release-verifier.js';

const options: VerifyGeneratedReleaseOptions = {
  baseRevision: 'base',
  expectedReleaseAppId: '12345',
  expectedReleaseBranch: 'changeset-release/main',
  headRevision: 'head',
  metadata: {
    authorId: '12345',
    headRef: 'changeset-release/main',
    headRepository: 'ShipfoxHQ/shipfox',
    repository: 'ShipfoxHQ/shipfox',
  },
  repositoryRoot: '/repository',
};

function commandWithTrees(generatedTree: string, headTree = generatedTree) {
  const calls: string[][] = [];
  const command = (_command: string, args: string[]) => {
    calls.push(args);
    if (args[0] === 'write-tree')
      return Promise.resolve({stdout: `${generatedTree}\n`, stderr: ''});
    if (args[0] === 'rev-parse') return Promise.resolve({stdout: `${headTree}\n`, stderr: ''});
    return Promise.resolve({stdout: '', stderr: ''});
  };
  return {calls, command};
}

describe('verifyGeneratedRelease', () => {
  test('classifies the exact generated tree as a generated release', async () => {
    const {command, calls} = commandWithTrees('generated-tree');

    const result = await verifyGeneratedRelease(options, command);

    assert.deepEqual(result, {
      classification: 'generated-release',
      reason: 'generated-tree-matches',
      message:
        'The pull request tree exactly matches changeset version output from its base revision.',
    });
    assert.deepEqual(
      calls.map((args) => args.slice(0, 3)),
      [
        ['worktree', 'add', '--detach'],
        ['install', '--frozen-lockfile', '--ignore-scripts'],
        ['exec', 'changeset', 'version'],
        ['add', '--all'],
        ['write-tree'],
        ['rev-parse', 'head^{tree}'],
        ['worktree', 'remove', '--force'],
      ],
    );
  });

  test('rejects a source or manifest change that the version command did not generate', async () => {
    const {command} = commandWithTrees('generated-tree', 'tampered-tree');

    const result = await verifyGeneratedRelease(options, command);

    assert.equal(result.classification, 'not-generated-release');
    assert.equal(result.reason, 'generated-tree-mismatch');
  });

  test.each([
    ['wrong repository', {headRepository: 'fork/shipfox'}, 'head-repository-mismatch'],
    ['wrong branch', {headRef: 'changeset-release/not-main'}, 'release-branch-mismatch'],
    ['wrong app', {authorId: '999'}, 'release-app-mismatch'],
  ])('rejects %s before creating a checkout', async (_name, metadata, reason) => {
    const {command, calls} = commandWithTrees('generated-tree');

    const result = await verifyGeneratedRelease(
      {...options, metadata: {...options.metadata, ...metadata}},
      command,
    );

    assert.equal(result.classification, 'not-generated-release');
    assert.equal(result.reason, reason);
    assert.deepEqual(calls, []);
  });

  test('fails closed when the version command fails and still removes its worktree', async () => {
    const calls: string[][] = [];
    const command = (_command: string, args: string[]) => {
      calls.push(args);
      if (args.join(' ') === 'exec changeset version')
        return Promise.reject(new Error('changeset failed'));
      return Promise.resolve({stdout: '', stderr: ''});
    };

    const result = await verifyGeneratedRelease(options, command);

    assert.equal(result.reason, 'version-command-failed');
    assert.deepEqual(calls.at(-1)?.slice(0, 3), ['worktree', 'remove', '--force']);
  });
});
