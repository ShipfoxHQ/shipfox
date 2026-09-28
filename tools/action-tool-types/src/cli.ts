import {relative} from 'node:path';
import {providerToolCatalogs} from '#catalogs.js';
import {generatedFilePath, repositoryRoot, writeToolCatalogFile} from '#generate.js';

const displayPath = relative(repositoryRoot, generatedFilePath);

await writeToolCatalogFile(providerToolCatalogs);
process.stdout.write(`Wrote ${displayPath}\n`);
