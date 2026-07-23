import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {auditClientSource, sourceFiles} from '../src/audit-client-architecture.js';

describe('auditClientSource', () => {
  test('allows checked API requests in a feature adapter', () => {
    const violations = auditClientSource(
      'libs/client/projects/src/hooks/api/list-projects.ts',
      "import {checkedApiRequest} from '@shipfox/client-api';\ncheckedApiRequest(schema, '/projects');",
    );
    assert.deepEqual(violations, []);
  });

  test('skips generated directories when finding source files', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'client-architecture-policy-'));
    try {
      await mkdir(path.join(directory, 'src'));
      await mkdir(path.join(directory, 'dist'));
      await mkdir(path.join(directory, 'node_modules', 'package'), {recursive: true});
      await Promise.all([
        writeFile(path.join(directory, 'src', 'source.ts'), ''),
        writeFile(path.join(directory, 'dist', 'generated.ts'), ''),
        writeFile(path.join(directory, 'node_modules', 'package', 'dependency.ts'), ''),
      ]);

      const files = await sourceFiles(directory);

      assert.deepEqual(files, [path.join(directory, 'src', 'source.ts')]);
    } finally {
      await rm(directory, {recursive: true});
    }
  });

  test('allows API requests inside the client API package', () => {
    const violations = auditClientSource(
      'libs/client/api/src/index.ts',
      "checkedApiRequest(schema, '/projects');",
    );

    assert.deepEqual(violations, []);
  });

  test('reports both unchecked and checked requests outside an adapter', () => {
    const violations = auditClientSource(
      'libs/client/projects/src/pages/project-page.tsx',
      "apiRequest('/projects');\ncheckedApiRequest(schema, '/projects');",
    );

    assert.deepEqual(violations, [
      {
        file: 'libs/client/projects/src/pages/project-page.tsx',
        occurrences: 2,
        rule: 'api-request-outside-adapter',
      },
      {
        file: 'libs/client/projects/src/pages/project-page.tsx',
        occurrences: 1,
        rule: 'unparsed-api-response',
      },
    ]);
  });

  test('reports unparsed API responses from a feature adapter', () => {
    const violations = auditClientSource(
      'libs/client/projects/src/hooks/api/list-projects.ts',
      "apiRequest('/projects');",
    );

    assert.deepEqual(violations, [
      {
        file: 'libs/client/projects/src/hooks/api/list-projects.ts',
        occurrences: 1,
        rule: 'unparsed-api-response',
      },
    ]);
  });

  test('reports raw route-search parsing outside an owned route module', () => {
    const violations = auditClientSource(
      'libs/client/projects/src/pages/projects-page.tsx',
      'useRouteSearch(parseProjectsSearch);',
    );

    assert.deepEqual(violations, [
      {
        file: 'libs/client/projects/src/pages/projects-page.tsx',
        occurrences: 1,
        rule: 'unchecked-route-search',
      },
    ]);
  });

  test('reports remaining semantic boundary crossings', () => {
    const page = auditClientSource(
      'libs/client/projects/src/pages/project-page.tsx',
      "import type {ProjectDto} from '@shipfox/api-projects-dto';\nimport {apiRequest} from '@shipfox/client-api';\napiRequest('/projects');",
    );
    assert.deepEqual(
      page.map((violation) => violation.rule),
      ['api-request-outside-adapter', 'unparsed-api-response'],
    );
  });
});
