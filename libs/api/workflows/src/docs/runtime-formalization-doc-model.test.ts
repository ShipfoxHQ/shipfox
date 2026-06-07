import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {
  renderRuntimeFormalizationDocs,
  runtimeFormalizationDocs,
  runtimeGeneratedSectionEnd,
  runtimeGeneratedSectionMarker,
  runtimeGeneratedSectionStart,
} from './runtime-formalization-doc-model.js';

const repoRoot = resolve(import.meta.dirname, '../../../../..');
const docsDir = resolve(repoRoot, 'docs/formalizing-shipfox-runtime');

describe('renderRuntimeFormalizationDocs', () => {
  test('renders runtime-owned formalization documents deterministically', () => {
    const firstRender = renderRuntimeFormalizationDocs();
    const secondRender = renderRuntimeFormalizationDocs();

    expect([...firstRender.entries()]).toEqual([...secondRender.entries()]);
    expect([...firstRender.keys()]).toEqual(runtimeFormalizationDocs.map((doc) => doc.fileName));
  });

  test('delimits generated sections in runtime-owned documents', () => {
    const renderedDocs = renderRuntimeFormalizationDocs();

    expect(runtimeGeneratedSectionMarker).toContain(
      'libs/api/workflows/scripts/generate-formalization-docs.ts',
    );

    for (const content of renderedDocs.values()) {
      expect(content).toContain(runtimeGeneratedSectionMarker);
      expect(content).toContain(runtimeGeneratedSectionStart);
      expect(content).toContain(runtimeGeneratedSectionEnd);
    }
  });

  test('matches the committed runtime formalization docs', async () => {
    const renderedDocs = renderRuntimeFormalizationDocs();

    for (const [fileName, content] of renderedDocs.entries()) {
      const committedContent = await readFile(resolve(docsDir, fileName), 'utf8');
      expect(committedContent).toBe(content);
    }
  });
});
