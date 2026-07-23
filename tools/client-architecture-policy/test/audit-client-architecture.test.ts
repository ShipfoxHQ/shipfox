import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  auditClientSource,
  inventoryClientSource,
  sourceFiles,
} from '../src/audit-client-architecture.js';

describe('auditClientSource', () => {
  test('allows checked API requests in a feature adapter', () => {
    const violations = auditClientSource(
      'libs/client/projects/src/hooks/api/list-projects.ts',
      "import {checkedApiRequest} from '@shipfox/client-api';\ncheckedApiRequest(schema, '/projects');",
    );
    assert.deepEqual(violations, []);
  });

  test('allows public feature contribution and route imports', () => {
    const violations = auditClientSource(
      'libs/client/features/src/index.ts',
      "import {projectsFeature} from '@shipfox/client-projects/feature';\nimport {ProjectBreadcrumb} from '@shipfox/client-projects';\nimport route from '@shipfox/client-projects/routes/home';",
    );

    assert.deepEqual(violations, []);
  });

  test('reports private feature imports', () => {
    const violations = auditClientSource(
      'libs/client/features/src/index.ts',
      "import {ProjectsPage} from '@shipfox/client-projects/src/pages/projects-page';",
    );

    assert.deepEqual(violations, [
      {
        file: 'libs/client/features/src/index.ts',
        occurrences: 1,
        rule: 'private-feature-import',
      },
    ]);
  });

  test('reports non-owning feature contributions', () => {
    const violations = auditClientSource(
      'libs/client/projects/src/feature.ts',
      `import {defineClientFeature} from '@shipfox/client-shell';
export const projectsFeature = defineClientFeature({
  id: 'shipfox.projects',
  routes: [{path: '/projects', parent: 'root', impl: '@shipfox/client-integrations/routes/integrations'}],
  navigation: [{id: 'integrations', scope: 'workspace', label: 'Integrations', to: '/integrations'}],
});`,
    );

    assert.deepEqual(violations, [
      {
        file: 'libs/client/projects/src/feature.ts',
        occurrences: 2,
        rule: 'non-owning-feature-contribution',
      },
    ]);
  });

  test('allows a non-owning contribution for a feature with an explicit coordinator', () => {
    const violations = auditClientSource(
      'libs/client/projects/src/feature.ts',
      `import {defineClientFeature} from '@shipfox/client-shell';
export const projectsFeature = defineClientFeature({
  id: 'shipfox.projects',
  coordinator: 'shipfox.projects',
  routes: [{path: '/projects', parent: 'root', impl: '@shipfox/client-integrations/routes/integrations'}],
  navigation: [{id: 'integrations', scope: 'workspace', label: 'Integrations', to: '/integrations'}],
});`,
    );

    assert.deepEqual(violations, []);
  });

  test('requires navigation registries to be defined in a feature manifest', () => {
    const violations = auditClientSource(
      'libs/client/projects/src/navigation.ts',
      "export const navigation = [{id: 'projects'}];",
    );

    assert.deepEqual(violations, [
      {
        file: 'libs/client/projects/src/navigation.ts',
        occurrences: 1,
        rule: 'non-owning-feature-contribution',
      },
    ]);
  });

  test('skips generated directories when finding source files', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'client-architecture-policy-'));
    try {
      await mkdir(path.join(directory, 'src'));
      await mkdir(path.join(directory, 'dist'));
      await mkdir(path.join(directory, 'node_modules', 'package'), {recursive: true});
      await mkdir(path.join(directory, 'test'));
      await Promise.all([
        writeFile(path.join(directory, 'src', 'source.ts'), ''),
        writeFile(path.join(directory, 'dist', 'generated.ts'), ''),
        writeFile(path.join(directory, 'node_modules', 'package', 'dependency.ts'), ''),
        writeFile(path.join(directory, 'test', 'fixture.ts'), ''),
        writeFile(path.join(directory, 'test', 'setup.ts'), ''),
        writeFile(path.join(directory, 'src', 'route.gen.ts'), ''),
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

  test('reports a checked business response returned without a domain mapper', () => {
    const violations = auditClientSource(
      'libs/client/projects/src/hooks/api/list-projects.ts',
      "return await checkedApiRequest(projectResponseSchema, '/projects');",
    );

    assert.deepEqual(violations, [
      {
        file: 'libs/client/projects/src/hooks/api/list-projects.ts',
        occurrences: 1,
        rule: 'unmapped-api-response',
      },
    ]);
  });

  test('reports checked responses from concise and parenthesized returns', () => {
    assert.deepEqual(
      auditClientSource(
        'libs/client/projects/src/hooks/api/list-projects.ts',
        "const listProjects = async () => checkedApiRequest(projectResponseSchema, '/projects');",
      ),
      [
        {
          file: 'libs/client/projects/src/hooks/api/list-projects.ts',
          occurrences: 1,
          rule: 'unmapped-api-response',
        },
      ],
    );
    assert.deepEqual(
      auditClientSource(
        'libs/client/projects/src/hooks/api/list-projects.ts',
        "return (await checkedApiRequest(projectResponseSchema, '/projects'));",
      ),
      [
        {
          file: 'libs/client/projects/src/hooks/api/list-projects.ts',
          occurrences: 1,
          rule: 'unmapped-api-response',
        },
      ],
    );
    assert.deepEqual(
      auditClientSource(
        'libs/client/projects/src/hooks/api/delete-project.ts',
        "const deleteProject = async () => (await checkedApiRequest(emptyResponseSchema, '/projects/id'));",
      ),
      [],
    );
  });

  test('requires reusable query options for adapter-owned query hooks', () => {
    const violations = auditClientSource(
      'libs/client/projects/src/hooks/api/projects.ts',
      "useQuery({queryKey: ['projects'], queryFn: () => listProjects({workspaceId: 'id'})});",
    );

    assert.deepEqual(violations, [
      {
        file: 'libs/client/projects/src/hooks/api/projects.ts',
        occurrences: 1,
        rule: 'inline-query-policy',
      },
    ]);
  });

  test('accepts a reusable query options policy and the documented step-log exception', () => {
    assert.deepEqual(
      auditClientSource(
        'libs/client/projects/src/hooks/api/projects.ts',
        "useQuery({...projectQueryOptions('id'), enabled: true});",
      ),
      [],
    );
    assert.deepEqual(
      auditClientSource(
        'libs/client/logs/src/hooks/api/step-logs.ts',
        "useQuery({queryKey: ['step-logs'], queryFn: readLogs});",
      ),
      [],
    );
  });

  test('keeps query hooks inside the adapter boundary', () => {
    const violations = auditClientSource(
      'libs/client/projects/src/pages/project-page.tsx',
      "useQuery(projectQueryOptions('id'));",
    );

    assert.deepEqual(violations, [
      {
        file: 'libs/client/projects/src/pages/project-page.tsx',
        occurrences: 1,
        rule: 'query-policy-outside-adapter',
      },
    ]);
  });

  test('handles generic query hooks and regex literals while finding query policies', () => {
    assert.deepEqual(
      auditClientSource(
        'libs/client/projects/src/hooks/api/projects.ts',
        "useQuery<Project>({queryFn: () => /\\(/.test(value)});\nprojectQueryOptions('id');",
      ),
      [
        {
          file: 'libs/client/projects/src/hooks/api/projects.ts',
          occurrences: 1,
          rule: 'inline-query-policy',
        },
      ],
    );
    assert.deepEqual(
      auditClientSource(
        'libs/client/projects/src/pages/project-page.tsx',
        'useQuery<Project>({queryFn: () => /\\(/.test(value)});',
      ),
      [
        {
          file: 'libs/client/projects/src/pages/project-page.tsx',
          occurrences: 1,
          rule: 'query-policy-outside-adapter',
        },
      ],
    );
  });

  test('allows empty response contracts without a domain mapper', () => {
    assert.deepEqual(
      auditClientSource(
        'libs/client/projects/src/hooks/api/delete-project.ts',
        "return await checkedApiRequest(emptyResponseSchema, '/projects/id');",
      ),
      [],
    );
  });

  test('summarizes checked requests and query policies for an adapter inventory', () => {
    assert.deepEqual(
      inventoryClientSource(
        'libs/client/projects/src/hooks/api/projects.ts',
        "checkedApiRequest(schema, '/projects');\nuseQuery(projectQueryOptions('id'));",
      ),
      {
        isAdapter: true,
        checkedApiRequestCalls: 1,
        queryHooks: 1,
        reusableQueryPolicies: 1,
      },
    );
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
