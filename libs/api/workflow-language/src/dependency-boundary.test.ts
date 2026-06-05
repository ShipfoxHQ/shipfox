import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);

type DependencyCruiserRule = {
  readonly name: string;
  readonly from: {
    readonly path: string;
  };
  readonly to: {
    readonly path: string;
  };
};

type DependencyCruiserConfig = {
  readonly forbidden: readonly DependencyCruiserRule[];
};

describe('workflow-language dependency boundary', () => {
  test('matches package-relative feature and runtime dependency paths', () => {
    const config = require('../../../../.dependency-cruiser.cjs') as DependencyCruiserConfig;
    const rule = config.forbidden.find(
      (candidate) => candidate.name === 'workflow-language-no-feature-runtime-dependencies',
    );

    expect(rule).toBeDefined();
    expect(rule?.from.path).toBe('^(src|test|scripts)/');

    const from = new RegExp(rule?.from.path ?? '$.');
    const to = new RegExp(rule?.to.path ?? '$.');

    expect(from.test('src/index.ts')).toBe(true);
    expect(from.test('test/example.test.ts')).toBe(true);
    expect(from.test('scripts/generate-formalization-docs.ts')).toBe(true);
    expect(to.test('../definitions/src/index.ts')).toBe(true);
    expect(to.test('../definitions-dto/src/index.ts')).toBe(true);
    expect(to.test('../workflows/src/index.ts')).toBe(true);
    expect(to.test('../triggers/src/index.ts')).toBe(true);
    expect(to.test('../runners/src/index.ts')).toBe(true);
    expect(to.test('../../client/runners/src/index.ts')).toBe(true);
    expect(to.test('../../../apps/api/src/index.ts')).toBe(true);
    expect(to.test('../../shared/node/drizzle/src/index.ts')).toBe(true);
    expect(to.test('../../shared/node/fastify/src/index.ts')).toBe(true);
    expect(to.test('../../shared/node/temporal/src/index.ts')).toBe(true);
    expect(to.test('node_modules/drizzle-orm/index.js')).toBe(true);
    expect(to.test('node_modules/fastify/fastify.js')).toBe(true);
    expect(to.test('node_modules/@temporalio/workflow/lib/index.js')).toBe(true);
    expect(to.test('../projects-dto/src/index.ts')).toBe(false);
  });
});
