import {spawnSync} from 'node:child_process';

runPacker(['init', '.']);
runPacker(['fmt', '-check', '.']);
runPacker([
  'validate',
  '-var',
  'architecture=amd64',
  '-var',
  'base_ami_id=ami-00000000000000000',
  '-var',
  'generation=ci',
  '-var',
  'kms_key_id=alias/ci',
  '-var',
  `recipe_digest=sha256:${'0'.repeat(64)}`,
  '-var',
  'revision=ci',
  '-var',
  'source_ami_id=ami-00000000000000000',
  '.',
]);

function runPacker(args) {
  const result = spawnSync('packer', args, {stdio: 'inherit'});
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
