import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {renderFormalizationDocs} from '#docs/formalization-doc-model.js';
import {
  formalizationReadmeFileName,
  renderFormalizationReadme,
} from '#docs/formalization-readme-model.js';

const docsDir = resolve(import.meta.dirname, '../../../..', 'docs/formalizing-shipfox-runtime');

await mkdir(docsDir, {recursive: true});

for (const [fileName, content] of renderFormalizationDocs()) {
  await writeFile(resolve(docsDir, fileName), content);
}

await writeFile(resolve(docsDir, formalizationReadmeFileName), renderFormalizationReadme());
