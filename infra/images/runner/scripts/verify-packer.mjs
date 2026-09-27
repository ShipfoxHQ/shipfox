import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {RUNNER_BASE_PREPARE_OS_SCRIPT} from '@shipfox/runner-base';

const runnerWorkspace = mkdtempSync(join(tmpdir(), 'shipfox-runner-workspace-'));

try {
  runPacker(['init', '.']);
  runPacker(['fmt', '-check', '.']);
  const sharedVars = [
    '-var',
    'build_attempt=1',
    '-var',
    'build_number=ci',
    '-var',
    `node_version=${process.versions.node}`,
    '-var',
    'platform=aws',
    '-var',
    'revision=ci',
    '-var',
    `runner_base_prepare_script=${RUNNER_BASE_PREPARE_OS_SCRIPT}`,
    '-var',
    `runner_workspace=${runnerWorkspace}`,
  ];
  // The complete Canonical build that release and QEMU images use.
  runPacker(['validate', ...sharedVars, '-var', 'runner_version=0.0.0-ci', '.']);
  // A candidate built from a verified runner base.
  runPacker([
    'validate',
    ...sharedVars,
    '-var',
    'image_lifecycle=candidate',
    '-var',
    'candidate_id=main-ci',
    '-var',
    'candidate_kms_key_id=arn:aws:kms:eu-central-1:123456789012:key/ci',
    '-var',
    'source_ami_id=ami-00000000000000000',
    '-var',
    'base_generation=ci-1',
    '-var',
    `base_recipe=sha256:${'0'.repeat(64)}`,
    '.',
  ]);
} finally {
  rmSync(runnerWorkspace, {force: true, recursive: true});
}

function runPacker(args) {
  const result = spawnSync('packer', args, {stdio: 'inherit'});
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
