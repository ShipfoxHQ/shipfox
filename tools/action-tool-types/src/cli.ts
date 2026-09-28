import {relative} from 'node:path';
import {providerToolCatalogs} from '#catalogs.js';
import {
  generatedFilePath,
  generatedGrantsFilePath,
  repositoryRoot,
  writeToolCatalogFile,
} from '#generate.js';

await writeToolCatalogFile(providerToolCatalogs);
for (const path of [generatedFilePath, generatedGrantsFilePath]) {
  process.stdout.write(`Wrote ${relative(repositoryRoot, path)}\n`);
}
