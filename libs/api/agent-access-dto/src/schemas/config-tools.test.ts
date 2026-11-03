import {Ajv} from 'ajv';
import * as addFormatsModule from 'ajv-formats';
import {
  commitConfigChangesInputJsonSchema,
  commitConfigChangesInputSchema,
  commitConfigChangesResultJsonSchema,
  listConfigFilesInputJsonSchema,
  listConfigFilesInputSchema,
  listConfigFilesResultJsonSchema,
  readConfigFileInputJsonSchema,
  readConfigFileInputSchema,
  readConfigFileResultJsonSchema,
} from './config-tools.js';

const addFormats = addFormatsModule.default as unknown as (validator: Ajv) => void;
const ajv = new Ajv({strict: false});
addFormats(ajv);
const projectId = '00000000-0000-4000-8000-000000000001';
const commit = 'a'.repeat(40);

describe('config tool schemas', () => {
  test('the commit input accepts writes and deletes in one call', () => {
    const input = {
      project_id: projectId,
      branch: 'shipfox/add-triage',
      message: 'Add triage',
      changes: [
        {path: '.shipfox/workflows/triage.yml', content: 'name: Triage\n'},
        {path: '.shipfox/workflows/old.yml', delete: true},
      ],
    };

    expect(commitConfigChangesInputSchema.safeParse(input).success).toBe(true);
    expect(ajv.validate(commitConfigChangesInputJsonSchema, input)).toBe(true);
  });

  test.each([
    ['no changes', {changes: []}],
    ['a change with both content and delete', {changes: [{path: 'a', content: 'x', delete: true}]}],
    ['a change with neither', {changes: [{path: 'a'}]}],
    ['a delete that is false', {changes: [{path: 'a', delete: false}]}],
    ['an empty message', {message: ''}],
    ['a short head', {expected_head: 'abc'}],
    ['an unknown field', {force: true}],
  ])('the commit input refuses %s', (_label, override) => {
    const input = {
      project_id: projectId,
      branch: 'shipfox/add-triage',
      message: 'Add triage',
      changes: [{path: '.shipfox/a.yml', content: 'x'}],
      ...override,
    };

    expect(commitConfigChangesInputSchema.safeParse(input).success).toBe(false);
    expect(ajv.validate(commitConfigChangesInputJsonSchema, input)).toBe(false);
  });

  test('the commit input caps the number of changes', () => {
    const changes = Array.from({length: 101}, (_, index) => ({
      path: `.shipfox/${index}.yml`,
      content: 'x',
    }));
    const input = {project_id: projectId, branch: 'b', message: 'm', changes};

    expect(commitConfigChangesInputSchema.safeParse(input).success).toBe(false);
    expect(ajv.validate(commitConfigChangesInputJsonSchema, input)).toBe(false);
  });

  test('the read inputs need a project, and the file read needs a path', () => {
    expect(listConfigFilesInputSchema.safeParse({project_id: projectId}).success).toBe(true);
    expect(ajv.validate(listConfigFilesInputJsonSchema, {project_id: projectId})).toBe(true);
    expect(listConfigFilesInputSchema.safeParse({}).success).toBe(false);
    expect(readConfigFileInputSchema.safeParse({project_id: projectId}).success).toBe(false);
    expect(
      ajv.validate(readConfigFileInputJsonSchema, {project_id: projectId, path: '.shipfox/a.yml'}),
    ).toBe(true);
  });

  test.each([
    'src/index.ts',
    '.shipfox',
    '.shipfox/../secret',
    '.shipfox//a.yml',
    '.shipfox/.git/config',
    '.shipfox/a\\b.yml',
    '.shipfox/a\nb.yml',
    '.shipfox/a\u0085b.yml',
  ])('the file read refuses the path %j', (path) => {
    expect(readConfigFileInputSchema.safeParse({project_id: projectId, path}).success).toBe(false);
  });

  test('the file read JSON schema refuses a path outside .shipfox/ or with a control character', () => {
    for (const path of ['src/index.ts', '.shipfox', '.shipfox/a\nb.yml']) {
      expect(ajv.validate(readConfigFileInputJsonSchema, {project_id: projectId, path})).toBe(
        false,
      );
    }
  });

  test('the project id must be a uuid in the JSON schema', () => {
    expect(ajv.validate(listConfigFilesInputJsonSchema, {project_id: 'nope'})).toBe(false);
  });

  test('result JSON schemas accept their results', () => {
    expect(
      ajv.validate(listConfigFilesResultJsonSchema, {
        commit,
        files: [{path: '.shipfox/a.yml', type: 'file', size_bytes: null}],
        next_cursor: null,
      }),
    ).toBe(true);
    expect(
      ajv.validate(readConfigFileResultJsonSchema, {path: '.shipfox/a.yml', commit, content: ''}),
    ).toBe(true);
    expect(
      ajv.validate(commitConfigChangesResultJsonSchema, {branch: 'b', commit, parent: commit}),
    ).toBe(true);
  });
});
