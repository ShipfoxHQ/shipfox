import assert from 'node:assert/strict';
import {auditClientSource, newViolations} from '../src/audit-client-architecture.js';

describe('auditClientSource', () => {
  test('allows API requests in a feature adapter', () => {
    const violations = auditClientSource(
      'libs/client/projects/src/hooks/api/list-projects.ts',
      "import {apiRequest} from '@shipfox/client-api';\napiRequest('/projects');",
    );
    assert.deepEqual(violations, []);
  });

  test('reports each prohibited boundary crossing', () => {
    const core = auditClientSource(
      'libs/client/projects/src/core/project.ts',
      "import type {ProjectDto} from '@shipfox/api-projects-dto';\nimport {useQuery} from '@tanstack/react-query';",
    );
    const page = auditClientSource(
      'libs/client/projects/src/pages/project-page.tsx',
      "import type {ProjectDto} from '@shipfox/api-projects-dto';\nimport {apiRequest} from '@shipfox/client-api';\napiRequest('/projects');",
    );
    const component = auditClientSource(
      'libs/client/projects/src/components/project-list.tsx',
      "import {useQueryClient} from '@tanstack/react-query';\nuseQueryClient();",
    );
    assert.deepEqual(
      core.map((violation) => violation.rule),
      ['core-api-dto-import', 'core-client-framework-import'],
    );
    assert.deepEqual(
      page.map((violation) => violation.rule),
      ['api-request-outside-adapter', 'response-dto-in-presentation'],
    );
    assert.deepEqual(
      component.map((violation) => violation.rule),
      ['leaf-query-cache-ownership'],
    );
  });

  test('reports only violations not present in the migration baseline', () => {
    const existing = {
      file: 'libs/client/auth/src/pages/login.tsx',
      rule: 'api-request-outside-adapter',
    } as const;
    const added = {
      file: 'libs/client/auth/src/pages/signup.tsx',
      rule: 'api-request-outside-adapter',
    } as const;
    assert.deepEqual(newViolations([existing, added], [existing]), [added]);
  });
});
