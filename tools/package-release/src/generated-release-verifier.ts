import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export type GeneratedReleaseClassification = 'generated-release' | 'not-generated-release';

export interface GeneratedReleaseVerificationResult {
  classification: GeneratedReleaseClassification;
  reason:
    | 'generated-tree-matches'
    | 'head-repository-mismatch'
    | 'release-branch-mismatch'
    | 'release-app-mismatch'
    | 'dependency-install-failed'
    | 'version-command-failed'
    | 'generated-tree-mismatch'
    | 'verification-error';
  message: string;
}

export interface ReleasePullRequestMetadata {
  authorId: string;
  headRef: string;
  headRepository: string;
  repository: string;
}

export interface VerifyGeneratedReleaseOptions {
  baseRevision: string;
  expectedReleaseAppId: string;
  expectedReleaseBranch: string;
  headRevision: string;
  metadata: ReleasePullRequestMetadata;
  repositoryRoot: string;
}

interface CommandResult {
  stderr: string;
  stdout: string;
}

type Command = (command: string, args: string[], cwd: string) => Promise<CommandResult>;

/**
 * Verifies the complete Git tree rather than trusting release-App identity.
 * The App and branch checks narrow the candidate set, but either can be copied
 * onto a malicious pull request; only regenerated content is the boundary.
 */
export async function verifyGeneratedRelease(
  options: VerifyGeneratedReleaseOptions,
  command: Command = run,
): Promise<GeneratedReleaseVerificationResult> {
  const metadataResult = verifyReleaseMetadata(options);
  if (metadataResult) return metadataResult;

  const repositoryRoot = resolve(options.repositoryRoot);
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'shipfox-generated-release-'));
  const checkoutRoot = join(temporaryRoot, 'checkout');
  let worktreeAdded = false;

  try {
    await command(
      'git',
      ['worktree', 'add', '--detach', checkoutRoot, options.baseRevision],
      repositoryRoot,
    );
    worktreeAdded = true;

    try {
      await command('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts'], checkoutRoot);
    } catch (error) {
      return rejection('dependency-install-failed', commandError(error));
    }

    try {
      await command('pnpm', ['exec', 'changeset', 'version'], checkoutRoot);
    } catch (error) {
      return rejection('version-command-failed', commandError(error));
    }

    await command('git', ['add', '--all'], checkoutRoot);
    const generatedTree = (await command('git', ['write-tree'], checkoutRoot)).stdout.trim();
    const headTree = (
      await command('git', ['rev-parse', `${options.headRevision}^{tree}`], repositoryRoot)
    ).stdout.trim();

    if (generatedTree !== headTree) {
      return rejection(
        'generated-tree-mismatch',
        'The pull request tree is not the exact output of changeset version from its base revision.',
      );
    }

    return {
      classification: 'generated-release',
      reason: 'generated-tree-matches',
      message:
        'The pull request tree exactly matches changeset version output from its base revision.',
    };
  } catch (error) {
    return rejection('verification-error', commandError(error));
  } finally {
    if (worktreeAdded) {
      try {
        await command('git', ['worktree', 'remove', '--force', checkoutRoot], repositoryRoot);
      } catch {
        // Removing the containing temporary directory still prevents verifier state from persisting.
      }
    }
    await rm(temporaryRoot, {recursive: true, force: true});
  }
}

function verifyReleaseMetadata(
  options: VerifyGeneratedReleaseOptions,
): GeneratedReleaseVerificationResult | undefined {
  const {metadata} = options;
  if (metadata.headRepository !== metadata.repository) {
    return rejection(
      'head-repository-mismatch',
      'The pull request head must come from this repository.',
    );
  }
  if (metadata.headRef !== options.expectedReleaseBranch) {
    return rejection(
      'release-branch-mismatch',
      'The pull request head is not the configured release branch.',
    );
  }
  if (metadata.authorId !== options.expectedReleaseAppId) {
    return rejection(
      'release-app-mismatch',
      'The pull request author is not the configured release App.',
    );
  }
  return undefined;
}

function rejection(
  reason: Exclude<GeneratedReleaseVerificationResult['reason'], 'generated-tree-matches'>,
  message: string,
): GeneratedReleaseVerificationResult {
  return {classification: 'not-generated-release', reason, message};
}

function commandError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function run(command: string, args: string[], cwd: string): Promise<CommandResult> {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(command, args, {cwd, stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) return resolveCommand({stdout, stderr});
      reject(new Error(`${command} ${args.join(' ')} exited with ${code}: ${stderr.trim()}`));
    });
  });
}

function readArgument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const baseRevision = readArgument('base');
  const headRevision = readArgument('head');
  const repository = readArgument('repository');
  const headRepository = readArgument('head-repository');
  const headRef = readArgument('head-ref');
  const authorId = readArgument('author-id');
  const expectedReleaseAppId = readArgument('release-app-id');
  const expectedReleaseBranch = readArgument('release-branch') ?? 'changeset-release/main';
  const repositoryRoot = readArgument('repository-root') ?? process.cwd();

  if (
    !baseRevision ||
    !headRevision ||
    !repository ||
    !headRepository ||
    !headRef ||
    !authorId ||
    !expectedReleaseAppId
  ) {
    process.stdout.write(
      `${JSON.stringify(rejection('verification-error', 'Missing required verifier arguments.'))}\n`,
    );
    process.exitCode = 2;
    return;
  }

  const result = await verifyGeneratedRelease({
    baseRevision,
    expectedReleaseAppId,
    expectedReleaseBranch,
    headRevision,
    metadata: {authorId, headRef, headRepository, repository},
    repositoryRoot,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stdout.write(
      `${JSON.stringify(rejection('verification-error', commandError(error)))}\n`,
    );
    process.exitCode = 1;
  });
}
