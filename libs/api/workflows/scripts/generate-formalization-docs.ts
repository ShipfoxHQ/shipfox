import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {renderRuntimeFormalizationDocs} from '#docs/runtime-formalization-doc-model.js';

const docsDir = resolve(import.meta.dirname, '../../../..', 'docs/formalizing-shipfox-runtime');

await mkdir(docsDir, {recursive: true});

for (const [fileName, content] of renderRuntimeFormalizationDocs()) {
  await writeFile(resolve(docsDir, fileName), content);
}
