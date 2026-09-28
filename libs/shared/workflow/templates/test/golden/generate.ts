import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {CURRENT_COMPOSITION} from '#index.js';
import {composeGoldenFiles, compositionPath} from './corpus.js';

// Regenerates the corpus of the current composition format. Older formats stay as they are.
const directory = compositionPath(CURRENT_COMPOSITION);
rmSync(directory, {recursive: true, force: true});
mkdirSync(directory, {recursive: true});
const files = composeGoldenFiles(CURRENT_COMPOSITION);
for (const [name, content] of files) writeFileSync(`${directory}${name}`, content);
process.stdout.write(`Wrote ${files.size} golden files to ${directory}\n`);
