import type {SurfaceWorkflowDocument} from '#core/surface/surface-workflow-document.js';
import {createStepId, createUniqueId, slugifyIdPart} from './ids.js';
import {irIdRuleReference, irNormalizationRuleReference} from './normalization-reference.js';
import {normalizeSurfaceDocumentToWorkflowIR} from './normalize-surface-document.js';

const coreIrOwnerPattern = /^libs\/api\/workflow-language\/src\/core\/ir\//u;

describe('irIdRuleReference', () => {
  test('documents ID examples produced by the actual ID helpers', () => {
    expect(irIdRuleReference.map((reference) => reference.generatedId)).toEqual([
      slugifyIdPart(' Build Main '),
      slugifyIdPart('build_main/main'),
      slugifyIdPart('!!!'),
      createUniqueId('build-main', new Set(['build-main'])),
      createStepId({
        jobId: 'build',
        stepName: 'Install deps',
        run: 'pnpm install',
        usedStepIds: new Set(),
      }),
      createStepId({
        jobId: 'build',
        run: 'pnpm install',
        usedStepIds: new Set(),
      }),
    ]);
  });

  test('keeps the ID rule set focused on normalizer-visible behavior', () => {
    expect(irIdRuleReference.map((reference) => reference.rule)).toEqual([
      'Trim and lowercase ID parts',
      'Replace non-alphanumeric runs with one hyphen',
      'Strip edge hyphens and fall back to `item`',
      'Append numeric suffixes for collisions',
      'Prefer explicit step names over run commands',
      'Use run commands for anonymous step IDs',
    ]);
  });
});

describe('irNormalizationRuleReference', () => {
  test('documents every PR1 normalization concept used by the core IR doc', () => {
    expect(irNormalizationRuleReference.map((reference) => reference.concept)).toEqual([
      'Workflow identity',
      'Trigger map ordering',
      'Job map ordering',
      'Authored job order',
      'Dependency edges',
      'Unresolved dependencies',
      'Runner selector',
      'Run steps',
      'Default acceptance',
    ]);
  });

  test('keeps each rule attached to owner, input, and behavior text', () => {
    for (const reference of irNormalizationRuleReference) {
      expect(reference.surfaceInput.length).toBeGreaterThan(0);
      expect(reference.irBehavior.length).toBeGreaterThan(0);
      expect(reference.owner).toMatch(coreIrOwnerPattern);
    }
  });

  test('keeps documented normalization concepts backed by current normalizer behavior', () => {
    const document = surfaceDocument({
      runner: 'linux',
      triggers: {
        'on push': {source: 'github', event: 'push'},
        manual: {source: 'manual', event: 'fire'},
      },
      jobs: {
        deploy: {needs: ['test', 'ghost job'], steps: [{name: 'Ship', run: 'deploy'}]},
        build: {steps: [{run: 'build'}]},
        test: {needs: 'build', runner: ['linux', 'test'], steps: [{run: 'test'}]},
      },
    });

    const ir = normalizeSurfaceDocumentToWorkflowIR(document);

    expect(rule('Workflow identity').irBehavior).toContain('WorkflowIR.id');
    expect(ir.id).toBe('test-workflow');
    expect(ir.name).toBe('Test Workflow');

    expect(rule('Trigger map ordering').irBehavior).toContain('sorted');
    expect(ir.triggers.map((trigger) => trigger.id)).toEqual(['manual', 'on-push']);

    expect(rule('Job map ordering').irBehavior).toContain('sorted');
    expect(ir.jobs.map((job) => job.id)).toEqual(['build', 'deploy', 'test']);

    expect(rule('Authored job order').irBehavior).toContain('JobIR.position');
    expect(
      ir.jobs.map((job) => ({id: job.id, position: job.position, sourceName: job.sourceName})),
    ).toEqual([
      {id: 'build', position: 1, sourceName: 'build'},
      {id: 'deploy', position: 0, sourceName: 'deploy'},
      {id: 'test', position: 2, sourceName: 'test'},
    ]);

    expect(rule('Dependency edges').irBehavior).toContain('{from, to}');
    expect(ir.dependencies).toEqual([
      {from: 'build', to: 'test'},
      {from: 'ghost job', to: 'deploy'},
      {from: 'test', to: 'deploy'},
    ]);

    expect(rule('Unresolved dependencies').irBehavior).toContain('preserved');
    expect(ir.jobs.find((job) => job.id === 'deploy')?.dependencies).toEqual(['test', 'ghost job']);

    expect(rule('Runner selector').irBehavior).toContain('single-item selector');
    expect(ir.runner).toEqual(['linux']);
    expect(ir.jobs.find((job) => job.id === 'build')?.runner).toBeNull();
    expect(ir.jobs.find((job) => job.id === 'test')?.runner).toEqual(['linux', 'test']);

    expect(rule('Run steps').irBehavior).toContain('workflow-level `StepIR[]`');
    expect(ir.steps.map((step) => step.id)).toEqual(['build.build', 'deploy.ship', 'test.test']);
    expect(ir.jobs.find((job) => job.id === 'deploy')?.steps).toEqual(['deploy.ship']);

    expect(rule('Default acceptance').irBehavior).toContain('default_run_exit_code');
    expect(ir.steps.every((step) => step.acceptance.kind === 'default_run_exit_code')).toBe(true);
  });
});

function rule(concept: string) {
  const reference = irNormalizationRuleReference.find((item) => item.concept === concept);
  if (!reference) {
    throw new Error(`Missing normalization rule reference: ${concept}`);
  }
  return reference;
}

function surfaceDocument(
  overrides: Partial<SurfaceWorkflowDocument> = {},
): SurfaceWorkflowDocument {
  return {
    name: 'Test Workflow',
    jobs: {
      build: {
        steps: [{run: 'echo hello'}],
      },
    },
    ...overrides,
  };
}
