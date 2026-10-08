import {z} from 'zod';
import {
  checkFlagValue,
  defineFlags,
  findDuplicateFlagKeys,
  flagEnvName,
  parseFlagOverride,
} from './index.js';

const flags = defineFlags({
  'sample-switch': {kind: 'boolean', default: false, desc: 'A sample switch.'},
  'sample-mode': {
    kind: 'config',
    schema: z.enum(['off', 'shadow', 'enforce']),
    default: 'off',
    desc: 'A sample mode.',
  },
});

describe('defineFlags', () => {
  test('sets the key of each definition from its entry', () => {
    expect(flags['sample-switch'].key).toBe('sample-switch');
    expect(flags['sample-mode'].key).toBe('sample-mode');
  });

  test.each([
    'Sample',
    'sample_switch',
    'sample--switch',
    '-sample',
    '1sample',
    '',
  ])('rejects the malformed key %j', (key) => {
    expect(() => defineFlags({[key]: {kind: 'boolean', default: false, desc: 'Bad key.'}})).toThrow(
      'kebab-case',
    );
  });

  test('rejects a default that fails the schema', () => {
    expect(() =>
      defineFlags({
        'sample-mode': {
          kind: 'config',
          schema: z.enum(['off', 'on']),
          default: 'enforce' as 'off',
          desc: 'Bad default.',
        },
      }),
    ).toThrow('invalid default');
  });
});

describe('flagEnvName', () => {
  test('derives FLAG_ plus the key in upper snake case', () => {
    expect(flagEnvName('definitions-actions')).toBe('FLAG_DEFINITIONS_ACTIONS');
    expect(flagEnvName('limits-concurrency-enforcement')).toBe(
      'FLAG_LIMITS_CONCURRENCY_ENFORCEMENT',
    );
  });
});

describe('checkFlagValue', () => {
  test('accepts a boolean for a boolean flag and rejects other types', () => {
    expect(checkFlagValue(flags['sample-switch'], true)).toEqual({ok: true, value: true});
    expect(checkFlagValue(flags['sample-switch'], 'true').ok).toBe(false);
  });

  test('checks a config value against the schema', () => {
    expect(checkFlagValue(flags['sample-mode'], 'shadow')).toEqual({ok: true, value: 'shadow'});
    expect(checkFlagValue(flags['sample-mode'], 'maybe').ok).toBe(false);
  });
});

describe('parseFlagOverride', () => {
  test('parses true and false for a boolean flag', () => {
    expect(parseFlagOverride(flags['sample-switch'], 'true')).toEqual({ok: true, value: true});
    expect(parseFlagOverride(flags['sample-switch'], ' false ')).toEqual({ok: true, value: false});
  });

  test.each(['1', 'yes', 'TRUE', ''])('rejects %j for a boolean flag', (raw) => {
    expect(parseFlagOverride(flags['sample-switch'], raw).ok).toBe(false);
  });

  test('parses JSON for a config flag', () => {
    expect(parseFlagOverride(flags['sample-mode'], '"enforce"')).toEqual({
      ok: true,
      value: 'enforce',
    });
  });

  test('rejects an unquoted string, invalid JSON, and a schema mismatch for a config flag', () => {
    expect(parseFlagOverride(flags['sample-mode'], 'enforce').ok).toBe(false);
    expect(parseFlagOverride(flags['sample-mode'], '"maybe"').ok).toBe(false);
  });
});

describe('findDuplicateFlagKeys', () => {
  test('returns each repeated key once', () => {
    const duplicate = {...flags['sample-switch']};
    expect(
      findDuplicateFlagKeys([flags['sample-switch'], duplicate, duplicate, flags['sample-mode']]),
    ).toEqual(['sample-switch']);
  });

  test('returns nothing when keys are unique', () => {
    expect(findDuplicateFlagKeys([flags['sample-switch'], flags['sample-mode']])).toEqual([]);
  });
});
