import {formalizationDocs} from './formalization-doc-model.js';
import {
  formalizationDocumentRoleReference,
  formalizationStatusMeaningReference,
} from './formalization-readme-reference.js';

const generatedDocByFileName = new Map(formalizationDocs.map((doc) => [doc.fileName, doc.status]));
const roleByFileName = new Map(
  formalizationDocumentRoleReference.map((reference) => [reference.fileName, reference]),
);

describe('formalizationStatusMeaningReference', () => {
  test('documents every status used by the README document catalog', () => {
    const documentedStatuses = new Set(
      formalizationStatusMeaningReference.map((reference) => reference.status),
    );

    for (const reference of formalizationDocumentRoleReference) {
      expect(documentedStatuses).toContain(reference.status);
    }
  });
});

describe('formalizationDocumentRoleReference', () => {
  test('contains unique document entries', () => {
    const fileNames = formalizationDocumentRoleReference.map((reference) => reference.fileName);

    expect(new Set(fileNames).size).toBe(fileNames.length);
  });

  test('keeps generated document statuses aligned with the generated doc model', () => {
    for (const reference of formalizationDocumentRoleReference.filter((item) => item.generated)) {
      expect(generatedDocByFileName.get(reference.fileName)).toBe(reference.status);
    }

    for (const doc of formalizationDocs) {
      const reference = roleByFileName.get(doc.fileName);

      expect(reference).toBeDefined();
      expect(reference?.generated).toBe(true);
      expect(reference?.status).toBe(doc.status);
    }
  });

  test('keeps generated document owners aligned with the generated doc model', () => {
    for (const doc of formalizationDocs) {
      const reference = roleByFileName.get(doc.fileName);

      expect(reference?.generatorOwner).toBe(doc.generatorOwner);
    }
  });

  test('keeps future platform examples exploratory and hand-authored', () => {
    expect(
      formalizationDocumentRoleReference.find(
        (reference) => reference.fileName === '010-future-platform-use-cases.md',
      ),
    ).toMatchObject({
      status: 'exploratory',
      generated: false,
      generatorOwner: 'hand-authored',
    });
  });
});
