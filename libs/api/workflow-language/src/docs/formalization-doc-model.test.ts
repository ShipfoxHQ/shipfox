import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {
  generatedSectionEnd,
  generatedSectionMarker,
  generatedSectionStart,
  renderFormalizationDocs,
  workflowLanguageFormalizationDocs,
} from './formalization-doc-model.js';
import {
  formalizationReadmeFileName,
  renderFormalizationReadme,
} from './formalization-readme-model.js';

const repoRoot = resolve(import.meta.dirname, '../../../../..');
const docsDir = resolve(repoRoot, 'docs/formalizing-shipfox-runtime');

describe('renderFormalizationDocs', () => {
  it('renders every required formalization document deterministically', () => {
    const firstRender = renderFormalizationDocs();
    const secondRender = renderFormalizationDocs();

    expect([...firstRender.entries()]).toEqual([...secondRender.entries()]);
    expect([...firstRender.keys()]).toEqual(
      workflowLanguageFormalizationDocs.map((doc) => doc.fileName),
    );
  });

  it('delimits generated sections in every document', () => {
    const renderedDocs = renderFormalizationDocs();

    for (const content of renderedDocs.values()) {
      expect(content).toContain(generatedSectionMarker);
      expect(content).toContain(generatedSectionStart);
      expect(content).toContain(generatedSectionEnd);
    }
  });

  it('matches the committed formalization docs', async () => {
    const renderedDocs = renderFormalizationDocs();

    for (const [fileName, content] of renderedDocs.entries()) {
      const committedContent = await readFile(resolve(docsDir, fileName), 'utf8');
      expect(committedContent).toBe(content);
    }
  });

  it('matches the committed formalization README', async () => {
    const committedContent = await readFile(resolve(docsDir, formalizationReadmeFileName), 'utf8');

    expect(committedContent).toBe(renderFormalizationReadme());
  });
});
