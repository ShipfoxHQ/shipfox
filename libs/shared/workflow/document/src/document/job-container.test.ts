import {workflowDocumentContainerSchema, workflowDocumentSchema} from './workflow-document.js';
import {InvalidWorkflowDocumentError, parseWorkflowDocument} from './workflow-document-parser.js';
import {buildWorkflowJsonSchema} from './workflow-json-schema.js';

type JsonSchema = Record<string, unknown>;

function interpolation(source: string): string {
  return '$'.concat('{{ ', source, ' }}');
}

function documentWithContainer(container: unknown) {
  return {
    name: 'container workflow',
    jobs: {build: {container, steps: [{run: 'node --version'}]}},
  };
}

function jobProperties(schema: JsonSchema): JsonSchema {
  const jobs = schema.properties as {jobs: {additionalProperties: {properties: JsonSchema}}};
  return jobs.jobs.additionalProperties.properties;
}

describe('workflowDocumentContainerSchema', () => {
  it('accepts an image string', () => {
    expect(workflowDocumentContainerSchema.parse('node:24-bookworm')).toBe('node:24-bookworm');
  });

  it('accepts every object field', () => {
    const container = {
      image: 'ghcr.io/acme/toolbox:2026.10',
      credentials: {username: 'acme-bot', password: interpolation('secrets.GHCR_TOKEN')},
      env: {LICENSE_KEY: interpolation('secrets.LICENSE'), RETRIES: 3, VERBOSE: true},
      options: '--cpus 4 --memory 12g -v cargo-cache:/usr/local/cargo/registry',
      docker_socket: false,
    };

    expect(workflowDocumentContainerSchema.parse(container)).toEqual(container);
  });

  it('accepts an image-only object', () => {
    expect(workflowDocumentContainerSchema.parse({image: 'node'})).toEqual({image: 'node'});
  });

  it('does not validate the options string', () => {
    const container = {image: 'node', options: '--network none --entrypoint sh'};

    expect(workflowDocumentContainerSchema.parse(container)).toEqual(container);
  });

  it.each([
    ['an empty string', ''],
    ['an object without an image', {options: '--cpus 4'}],
    ['an empty image', {image: ''}],
    ['volumes', {image: 'node', volumes: ['/cache:/cache']}],
    ['ports', {image: 'node', ports: ['8080:80']}],
    ['credentials without a password', {image: 'node', credentials: {username: 'bot'}}],
    ['credentials without a username', {image: 'node', credentials: {password: 'secret'}}],
    [
      'unknown credential fields',
      {image: 'node', credentials: {username: 'a', password: 'b', c: 'd'}},
    ],
    ['an invalid env name', {image: 'node', env: {'1BAD': 'x'}}],
    ['a non-boolean docker_socket', {image: 'node', docker_socket: 'yes'}],
    ['a non-string options value', {image: 'node', options: ['--cpus', '4']}],
  ])('rejects %s', (_name, container) => {
    expect(workflowDocumentContainerSchema.safeParse(container).success).toBe(false);
  });

  it('lives on the job schema', () => {
    const result = workflowDocumentSchema.safeParse(documentWithContainer('node'));

    expect(result.success).toBe(true);
  });
});

describe('parseWorkflowDocument jobContainers', () => {
  it('accepts the field by default', () => {
    const document = documentWithContainer({image: 'node', docker_socket: false});

    expect(parseWorkflowDocument(document)).toEqual(document);
  });

  it('validates the container shape', () => {
    expect(() =>
      parseWorkflowDocument(documentWithContainer({image: 'node', ports: ['80:80']})),
    ).toThrow(InvalidWorkflowDocumentError);
  });

  it('rejects the field when disabled', () => {
    let error: unknown;
    try {
      parseWorkflowDocument(documentWithContainer('node'), {jobContainers: false});
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(InvalidWorkflowDocumentError);
    expect((error as InvalidWorkflowDocumentError).validationError.issues).toEqual([
      expect.objectContaining({
        path: ['jobs', 'build', 'container'],
        message: 'Job containers (`container`) are not supported yet.',
      }),
    ]);
  });

  it('reports only that the field is unsupported, not its shape, when disabled', () => {
    let error: unknown;
    try {
      parseWorkflowDocument(documentWithContainer({volumes: []}), {jobContainers: false});
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(InvalidWorkflowDocumentError);
    expect((error as InvalidWorkflowDocumentError).validationError.issues).toEqual([
      expect.objectContaining({
        path: ['jobs', 'build', 'container'],
        message: 'Job containers (`container`) are not supported yet.',
      }),
    ]);
  });

  it('leaves documents without a container unchanged either way', () => {
    const document = {name: 'plain', jobs: {build: {steps: [{run: 'echo ok'}]}}};

    expect(parseWorkflowDocument(document, {jobContainers: false})).toEqual(
      parseWorkflowDocument(document),
    );
  });
});

describe('buildWorkflowJsonSchema containers', () => {
  it('publishes the container field by default', () => {
    const properties = jobProperties(buildWorkflowJsonSchema());

    expect(properties.container).toMatchObject({
      anyOf: [
        {type: 'string', minLength: 1},
        {type: 'object', required: ['image'], additionalProperties: false},
      ],
    });
  });

  it('strips the container field when disabled', () => {
    expect(jobProperties(buildWorkflowJsonSchema({containers: false}))).not.toHaveProperty(
      'container',
    );
  });

  it('keeps every container property described', () => {
    const container = jobProperties(buildWorkflowJsonSchema()).container as {
      description?: string;
      anyOf: {properties?: Record<string, {description?: string}>}[];
    };
    const objectProperties = container.anyOf.find((option) => option.properties)?.properties ?? {};

    expect(container.description).toEqual(expect.any(String));
    expect(Object.keys(objectProperties).sort()).toEqual([
      'credentials',
      'docker_socket',
      'env',
      'image',
      'options',
    ]);
    for (const property of Object.values(objectProperties)) {
      expect(property.description).toEqual(expect.any(String));
    }
  });
});
