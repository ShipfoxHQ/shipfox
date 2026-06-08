import {validateDefinition} from './validate-definition.js';

describe('validateDefinition', () => {
  test('valid YAML returns { valid: true, spec }', () => {
    const yaml = `
name: Test
jobs:
  build:
    steps:
      - run: echo hello
`;

    const result = validateDefinition(yaml);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.spec.name).toBe('Test');
      expect(result.spec.jobs.build?.steps).toHaveLength(1);
    }
  });

  test('invalid YAML syntax returns { valid: false, errors }', () => {
    const result = validateDefinition('name: Bad\n  invalid:\nindentation');

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.message).toContain('Invalid YAML syntax');
    }
  });

  test('non-object YAML returns { valid: false, errors }', () => {
    const stringResult = validateDefinition('just a string');
    expect(stringResult.valid).toBe(false);

    const nullResult = validateDefinition('');
    expect(nullResult.valid).toBe(false);

    const arrayResult = validateDefinition('- item1\n- item2');
    expect(arrayResult.valid).toBe(false);
  });

  test('invalid spec returns { valid: false, errors with details }', () => {
    const yaml = `
jobs:
  build:
    steps:
      - run: echo hello
`;

    const result = validateDefinition(yaml);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]?.message).toBeDefined();
    }
  });

  test('array index paths use bracket notation for DTO validation errors', () => {
    const yaml = `
name: Missing run
jobs:
  build:
    steps:
      - name: missing
`;

    const result = validateDefinition(yaml);

    expect(result).toEqual({
      valid: false,
      errors: [
        {
          message: 'Invalid input: expected string, received undefined',
          path: 'jobs.build.steps[0].run',
        },
      ],
    });
  });

  test('cyclic DAG returns { valid: false, errors with cycle info }', () => {
    const yaml = `
name: Cyclic
jobs:
  a:
    needs: b
    steps:
      - run: echo a
  b:
    needs: a
    steps:
      - run: echo b
`;

    const result = validateDefinition(yaml);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]?.message).toContain('Circular dependency');
    }
  });

  test('legacy trigger on field remains accepted in platform WorkflowSpec', () => {
    const yaml = `
name: Legacy on
triggers:
  push:
    source: github
    event: push
    on: main
jobs:
  build:
    steps:
      - run: echo hello
`;

    const result = validateDefinition(yaml);

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.spec.triggers?.push?.on).toBe('main');
  });

  test('valid trigger filter expressions remain accepted', () => {
    const yaml = `
name: Valid filter
triggers:
  push:
    source: github
    event: push
    filter: event.ref == "refs/heads/main"
jobs:
  build:
    steps:
      - run: echo hello
`;

    const result = validateDefinition(yaml);

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.spec.triggers?.push?.filter).toBe('event.ref == "refs/heads/main"');
  });

  test('stable id collisions are rejected by semantic validation', () => {
    const yaml = `
name: Collision
jobs:
  deploy prod:
    steps:
      - run: echo deploy
  deploy-prod:
    steps:
      - run: echo deploy
`;

    const result = validateDefinition(yaml);

    expect(result).toEqual({
      valid: false,
      errors: [
        {
          message:
            'Job names "deploy prod" and "deploy-prod" resolve to the same stable id "deploy-prod".',
          path: 'jobs.deploy-prod',
        },
      ],
    });
  });

  test('semantic model diagnostics are returned as validation errors', () => {
    const yaml = `
name: Bad dependency
jobs:
  test:
    needs: build
    steps:
      - run: npm test
`;

    const result = validateDefinition(yaml);

    expect(result).toEqual({
      valid: false,
      errors: [
        {
          message: 'Job "test" depends on unknown job "build".',
          path: 'jobs.test.needs',
        },
      ],
    });
  });

  test('expression diagnostics from the model path are returned as validation errors', () => {
    const yaml = `
name: Bad expression
triggers:
  push:
    source: github
    event: push
    filter: step.output.pass == true
jobs:
  build:
    steps:
      - run: echo hello
`;

    const result = validateDefinition(yaml);

    expect(result).toEqual({
      valid: false,
      errors: [
        {
          message: 'Trigger "push" has an invalid filter expression.',
          path: 'triggers.push.filter',
        },
      ],
    });
  });

  test('declaring more than one manual trigger returns a validation error', () => {
    const yaml = `
name: Multi manual
triggers:
  deploy:
    source: manual
  rollback:
    source: manual
jobs:
  run:
    steps:
      - run: echo hello
`;

    const result = validateDefinition(yaml);

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors[0]?.message).toContain('at most one manual trigger');
    expect(result.errors[0]?.path).toBe('triggers');
  });
});
