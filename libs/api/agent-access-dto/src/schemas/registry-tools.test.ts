import {Ajv} from 'ajv';
import {
  diffRegistryActionInputJsonSchema,
  diffRegistryActionInputSchema,
  diffRegistryActionResultJsonSchema,
  diffRegistryActionResultSchema,
  getRegistryPackageInputJsonSchema,
  getRegistryPackageInputSchema,
  listRegistryPackagesInputJsonSchema,
  listRegistryPackagesInputSchema,
} from './registry-tools.js';

const ajv = new Ajv({strict: false});

describe('registry tool schemas', () => {
  test.each([
    ['list_registry_packages', listRegistryPackagesInputJsonSchema, {kind: 'action'}],
    ['get_registry_package', getRegistryPackageInputJsonSchema, {package: 'shipfox/digest'}],
    [
      'diff_registry_action',
      diffRegistryActionInputJsonSchema,
      {package: 'shipfox/digest', from: '1.0.0', to: '1.1.0'},
    ],
  ])('%s input JSON schema is a strict object', (_name, schema, sample) => {
    expect(schema).toMatchObject({type: 'object', additionalProperties: false});
    expect(ajv.validate(schema, sample)).toBe(true);
    expect(ajv.validate(schema, {...sample, extra: true})).toBe(false);
  });

  test('inputs reject malformed package names and versions', () => {
    expect(getRegistryPackageInputSchema.safeParse({package: 'digest'}).success).toBe(false);
    expect(
      getRegistryPackageInputSchema.safeParse({package: 'shipfox/digest', version: '1.0'}).success,
    ).toBe(false);
    expect(listRegistryPackagesInputSchema.safeParse({kind: 'plugin'}).success).toBe(false);
    expect(
      diffRegistryActionInputSchema.safeParse({package: 'shipfox/digest', from: '1.0.0'}).success,
    ).toBe(false);
  });

  test('the diff result JSON schema accepts a later page with only the diff', () => {
    const later = {
      package: 'shipfox/digest',
      from: '1.0.0',
      to: '1.1.0',
      source_diff: '--- a/x\n',
      next_cursor: null,
    };

    expect(diffRegistryActionResultSchema.safeParse(later).success).toBe(true);
    expect(ajv.validate(diffRegistryActionResultJsonSchema, later)).toBe(true);
  });
});
