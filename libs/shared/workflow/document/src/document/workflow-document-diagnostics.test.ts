import {validateWorkflowDocument} from './workflow-document-diagnostics.js';

describe('validateWorkflowDocument', () => {
  it('returns the parsed document when valid', () => {
    const workflowDocument = {
      name: 'simple build',
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const result = validateWorkflowDocument(workflowDocument);

    expect(result).toEqual({
      valid: true,
      document: workflowDocument,
      diagnostics: [],
    });
  });

  it.each([
    [
      'a non-object root document',
      'not a workflow',
      {
        code: 'WFD001',
        message: 'workflow document must be an object.',
        path: [],
      },
    ],
    [
      'a missing top-level field',
      {name: 'simple build'},
      {
        code: 'WFD002',
        message: 'jobs is required.',
        path: ['jobs'],
      },
    ],
    [
      'an unknown top-level field',
      {
        name: 'simple build',
        jobz: {},
        jobs: {build: {steps: [{run: 'npm test'}]}},
      },
      {
        code: 'WFD003',
        message: 'jobz is not supported.',
        path: ['jobz'],
        details: {field: 'jobz'},
      },
    ],
    [
      'an empty jobs map',
      {name: 'simple build', jobs: {}},
      {
        code: 'WFD005',
        message: 'jobs must contain at least one entry.',
        path: ['jobs'],
      },
    ],
    [
      'an empty top-level runner array',
      {name: 'simple build', runner: [], jobs: {build: {steps: [{run: 'npm test'}]}}},
      {
        code: 'WFD201',
        message: 'runner must not be empty.',
        path: ['runner'],
      },
    ],
    [
      'an empty needs array',
      {name: 'simple build', jobs: {test: {needs: [], steps: [{run: 'npm test'}]}}},
      {
        code: 'WFD202',
        message: 'jobs.test.needs must not be empty.',
        path: ['jobs', 'test', 'needs'],
      },
    ],
    [
      'a step without an action',
      {name: 'simple build', jobs: {build: {steps: [{name: 'build'}]}}},
      {
        code: 'WFD301',
        message: 'jobs.build.steps[0] must define run or agent.',
        path: ['jobs', 'build', 'steps', 0],
      },
    ],
  ])('returns a stable diagnostic for %s', (_label, workflowDocument, diagnostic) => {
    const result = validateWorkflowDocument(workflowDocument);

    expect(result).toEqual({
      valid: false,
      diagnostics: [expect.objectContaining({severity: 'error', ...diagnostic})],
    });
  });

  it('returns a trigger diagnostic when event is missing', () => {
    const workflowDocument = {
      name: 'simple build',
      triggers: {github: {source: 'github'}},
      jobs: {build: {steps: [{run: 'npm test'}]}},
    };

    const result = validateWorkflowDocument(workflowDocument);

    expect(result).toEqual({
      valid: false,
      diagnostics: [
        {
          code: 'WFD102',
          severity: 'error',
          message: 'triggers.github.event is required.',
          path: ['triggers', 'github', 'event'],
        },
      ],
    });
  });

  it('returns a dedicated diagnostic when a trigger uses unsupported on', () => {
    const workflowDocument = {
      name: 'simple build',
      triggers: {github: {source: 'github', on: 'push'}},
      jobs: {build: {steps: [{run: 'npm test'}]}},
    };

    const result = validateWorkflowDocument(workflowDocument);

    expect(result).toEqual({
      valid: false,
      diagnostics: [
        {
          code: 'WFD101',
          severity: 'error',
          message: 'Trigger field "on" is not supported; use "event".',
          path: ['triggers', 'github', 'on'],
          details: {field: 'on'},
        },
      ],
    });
  });

  it('returns only the unsupported on diagnostic when event and on are both present', () => {
    const workflowDocument = {
      name: 'simple build',
      triggers: {github: {source: 'github', event: 'push', on: 'pull_request'}},
      jobs: {build: {steps: [{run: 'npm test'}]}},
    };

    const result = validateWorkflowDocument(workflowDocument);

    expect(result).toEqual({
      valid: false,
      diagnostics: [
        expect.objectContaining({
          code: 'WFD101',
          path: ['triggers', 'github', 'on'],
        }),
      ],
    });
  });

  it('returns the missing prompt diagnostic for an agent step', () => {
    const workflowDocument = {
      name: 'review',
      jobs: {
        review: {
          steps: [{agent: 'reviewer'}],
        },
      },
    };

    const result = validateWorkflowDocument(workflowDocument);

    expect(result).toEqual({
      valid: false,
      diagnostics: [
        {
          code: 'WFD002',
          severity: 'error',
          message: 'jobs.review.steps[0].prompt is required.',
          path: ['jobs', 'review', 'steps', 0, 'prompt'],
        },
      ],
    });
  });

  it('returns the nested gate diagnostic for an agent step', () => {
    const workflowDocument = {
      name: 'review',
      jobs: {
        review: {
          steps: [{agent: 'reviewer', prompt: '/review', gate: {success_if: 123}}],
        },
      },
    };

    const result = validateWorkflowDocument(workflowDocument);

    expect(result).toEqual({
      valid: false,
      diagnostics: [
        {
          code: 'WFD302',
          severity: 'error',
          message: 'Invalid input: expected string, received number',
          path: ['jobs', 'review', 'steps', 0, 'gate', 'success_if'],
          details: {zodCode: 'invalid_type'},
        },
      ],
    });
  });

  it('returns the unknown field diagnostic for run-only steps', () => {
    const workflowDocument = {
      name: 'build',
      jobs: {
        build: {
          steps: [{run: 'npm test', output_schema: {pass: 'boolean'}}],
        },
      },
    };

    const result = validateWorkflowDocument(workflowDocument);

    expect(result).toEqual({
      valid: false,
      diagnostics: [
        {
          code: 'WFD003',
          severity: 'error',
          message: 'jobs.build.steps[0].output_schema is not supported.',
          path: ['jobs', 'build', 'steps', 0, 'output_schema'],
          details: {field: 'output_schema'},
        },
      ],
    });
  });
});
