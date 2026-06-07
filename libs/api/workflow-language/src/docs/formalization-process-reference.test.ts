import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {formalizationDocs} from './formalization-doc-model.js';
import {
  conceptChangeChecklistReference,
  docGenerationCapabilityReference,
  requirementStatusReference,
} from './formalization-process-reference.js';

const formalizationDocFileNames = new Set(formalizationDocs.map((doc) => doc.fileName));
const generatedOutputFileNames = new Set([...formalizationDocFileNames, 'README.md']);
const repoRoot = resolve(import.meta.dirname, '../../../../..');
const temporaryPathSentinel = ['/private', 'tmp'].join('/');
const temporaryDocsDirSentinel = ['formalizing-shipfox-runtime', 'docs'].join('-');

describe('requirementStatusReference', () => {
  test('points every requirement row at committed formalization docs', () => {
    for (const reference of requirementStatusReference) {
      expect(reference.primaryDocs.length).toBeGreaterThan(0);
      for (const docFileName of reference.primaryDocs) {
        expect(formalizationDocFileNames).toContain(docFileName);
      }
    }
  });

  test('keeps included requirements attached to code owners and deferred requirements explicit', () => {
    for (const reference of requirementStatusReference) {
      if (reference.pr1Status === 'Deferred') {
        expect(reference.primaryCode).toEqual(['deferred']);
      } else {
        expect(reference.primaryCode).not.toContain('deferred');
      }
    }
  });

  test('points included requirement code references at existing repository paths', () => {
    for (const reference of requirementStatusReference) {
      for (const codePath of reference.primaryCode) {
        if (codePath !== 'deferred') {
          expect(existsSync(resolve(repoRoot, codePath))).toBe(true);
        }
      }
    }
  });

  test('does not leak temporary planning paths', () => {
    for (const reference of requirementStatusReference) {
      const searchableText = [
        reference.requirement,
        reference.pr1Status,
        ...reference.primaryDocs,
        ...reference.primaryCode,
      ].join('\n');

      expect(searchableText).not.toContain(temporaryPathSentinel);
      expect(searchableText).not.toContain(temporaryDocsDirSentinel);
    }
  });
});

describe('conceptChangeChecklistReference', () => {
  test('covers the expected formalization layers in order', () => {
    expect(conceptChangeChecklistReference.map((reference) => reference.layer)).toEqual([
      'Requirement',
      'Classification',
      'Surface',
      'Expression',
      'IR',
      'Static semantics',
      'Runtime',
      'Durable execution host',
      'Docs and tests',
      'Deferrals',
    ]);
  });

  test('uses contiguous one-based steps', () => {
    expect(conceptChangeChecklistReference.map((reference) => reference.step)).toEqual(
      conceptChangeChecklistReference.map((_, index) => index + 1),
    );
  });

  test('keeps every process step actionable', () => {
    for (const reference of conceptChangeChecklistReference) {
      expect(reference.layer.length).toBeGreaterThan(0);
      expect(reference.action.length).toBeGreaterThan(0);
      expect(reference.requiredArtifacts.length).toBeGreaterThan(0);
      expect(reference.expectedTests.length).toBeGreaterThan(0);
      expect(reference.generatedDocsImpact.length).toBeGreaterThan(0);
    }
  });

  test('points generated-doc impacts at committed formalization docs', () => {
    const docFileNamePattern = /\b\d{3}-[a-z0-9-]+\.md\b/gu;

    for (const reference of conceptChangeChecklistReference) {
      const docFileNames = [...reference.generatedDocsImpact.matchAll(docFileNamePattern)].map(
        (match) => match[0],
      );

      for (const docFileName of docFileNames) {
        expect(formalizationDocFileNames).toContain(docFileName);
      }
    }
  });
});

describe('docGenerationCapabilityReference', () => {
  test('documents owner, input, output, and test coverage for every capability', () => {
    for (const reference of docGenerationCapabilityReference) {
      expect(reference.owners.length).toBeGreaterThan(0);
      expect(reference.inputs.length).toBeGreaterThan(0);
      expect(reference.outputDocs.length).toBeGreaterThan(0);
      expect(reference.tests.length).toBeGreaterThan(0);
    }
  });

  test('points every capability owner and test at an existing repository path', () => {
    for (const reference of docGenerationCapabilityReference) {
      for (const ownerPath of reference.owners) {
        expect(existsSync(resolve(repoRoot, ownerPath))).toBe(true);
      }
      for (const testPath of reference.tests) {
        expect(existsSync(resolve(repoRoot, testPath))).toBe(true);
      }
    }
  });

  test('covers each generated workflow-language-owned doc at least once', () => {
    const generatedDocs = new Set(
      docGenerationCapabilityReference.flatMap((reference) => reference.outputDocs),
    );

    for (const doc of formalizationDocs.filter(
      (item) => item.fileName !== '010-future-platform-use-cases.md',
    )) {
      expect(generatedDocs).toContain(doc.fileName);
    }

    for (const outputDoc of generatedDocs) {
      expect(generatedOutputFileNames).toContain(outputDoc);
    }
  });

  test('does not leak temporary planning paths', () => {
    for (const reference of docGenerationCapabilityReference) {
      const searchableText = [
        reference.capability,
        ...reference.owners,
        reference.inputs,
        ...reference.outputDocs,
        ...reference.tests,
      ].join('\n');

      expect(searchableText).not.toContain(temporaryPathSentinel);
      expect(searchableText).not.toContain(temporaryDocsDirSentinel);
    }
  });
});
