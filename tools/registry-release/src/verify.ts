import {execFile} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import type {RegistryReference} from '@shipfox/registry-format';
import {buildPackage} from './build.js';
import type {RegistryReader} from './registry-client.js';

const execFileAsync = promisify(execFile);

export interface VerifyResult {
  ok: boolean;
  mismatches: string[];
}

/**
 * Rebuilds a published version from its provenance commit and compares the
 * content and source digests with the version document. The recipe of this
 * checkout runs on the files of that commit, and the composition format
 * stamped in the document keeps the composer's output stable.
 */
export async function verifyVersion({
  reference,
  registry,
  root,
  toolVersion,
}: {
  reference: RegistryReference;
  registry: RegistryReader;
  root: string;
  toolVersion: string;
}): Promise<VerifyResult> {
  const name = `${reference.namespace}/${reference.name}`;
  const document = await registry.getVersionDocument({package: name, version: reference.version});
  if (document === undefined) throw new Error(`${name}@${reference.version} is not published`);

  const worktree = await mkdtemp(join(tmpdir(), 'shipfox-registry-verify-'));
  try {
    await execFileAsync(
      'git',
      ['worktree', 'add', '--detach', worktree, document.provenance.commit],
      {
        cwd: root,
      },
    );
    const built = await buildPackage({
      configured: {
        package: name,
        kind: document.kind,
        root: worktree,
        path: document.provenance.path,
        directory: join(worktree, document.provenance.path),
      },
      toolVersion,
    });
    const mismatches = [
      ...(built.content.digest === document.content.digest
        ? []
        : [`content: rebuilt ${built.content.digest}, published ${document.content.digest}`]),
      ...(built.source.digest === document.source.digest
        ? []
        : [`source: rebuilt ${built.source.digest}, published ${document.source.digest}`]),
    ];
    return {ok: mismatches.length === 0, mismatches};
  } finally {
    await execFileAsync('git', ['worktree', 'remove', '--force', worktree], {cwd: root}).catch(
      () => undefined,
    );
    await rm(worktree, {recursive: true, force: true});
  }
}
