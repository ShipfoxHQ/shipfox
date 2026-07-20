import {access, cp, mkdtemp, readFile, rename, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {
  createProductionManifestPacker,
  run,
} from '../../../../../../dev/productionized-manifest-packer.mjs';

const fixtureSource = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(fixtureSource, '../..');
const dtoPackageRoot = resolve(packageRoot, '../core-dto');
const interModulePackageRoot = resolve(packageRoot, '../../../shared/common/inter-module');
const workflowsDtoPackageRoot = resolve(packageRoot, '../../workflows-dto');
const fixtureRoot = await mkdtemp(join(tmpdir(), 'api-integration-webhook-external-'));
const manifestPacker = createProductionManifestPacker();

async function packPackage(root, destination) {
  const manifestPath = join(root, 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  await manifestPacker.pack(manifestPath, manifest, (signal) =>
    run('pnpm', ['pack', '--out', destination], root, {signal}),
  );
}

async function verifyInstalledExport(packageName) {
  const installedRoot = join(fixtureRoot, 'node_modules', packageName);
  const manifest = JSON.parse(await readFile(join(installedRoot, 'package.json'), 'utf8'));
  const publishedExport = manifest.exports?.['.'];
  if (
    !publishedExport ||
    typeof publishedExport !== 'object' ||
    typeof publishedExport.default !== 'string' ||
    typeof publishedExport.types !== 'string'
  ) {
    throw new Error(`${packageName} is missing root runtime or type exports`);
  }
  if (JSON.stringify(manifest).includes('workspace:')) {
    throw new Error(`${packageName} contains a workspace dependency range`);
  }
  await Promise.all([
    access(join(installedRoot, publishedExport.default)),
    access(join(installedRoot, publishedExport.types)),
  ]);
}

try {
  await cp(fixtureSource, fixtureRoot, {
    recursive: true,
    filter: (source) => source !== fileURLToPath(import.meta.url),
  });
  await rename(join(fixtureRoot, 'package.template.json'), join(fixtureRoot, 'package.json'));
  await packPackage(dtoPackageRoot, join(fixtureRoot, 'api-integration-core-dto.tgz'));
  await packPackage(interModulePackageRoot, join(fixtureRoot, 'inter-module.tgz'));
  await packPackage(workflowsDtoPackageRoot, join(fixtureRoot, 'api-workflows-dto.tgz'));
  await packPackage(packageRoot, join(fixtureRoot, 'api-integration-core.tgz'));
  await run('pnpm', ['install', '--ignore-scripts'], fixtureRoot);
  await verifyInstalledExport('@shipfox/api-integration-core');
  await verifyInstalledExport('@shipfox/api-integration-core-dto');
  await run('pnpm', ['run', 'check'], fixtureRoot);
  await run('pnpm', ['run', 'build'], fixtureRoot);
  await run('pnpm', ['run', 'start'], fixtureRoot);
} finally {
  manifestPacker.dispose();
  await rm(fixtureRoot, {recursive: true, force: true});
}
