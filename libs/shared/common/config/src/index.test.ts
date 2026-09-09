import {bool, createConfig, fallbackTo, num, str, url} from './index.js';

describe('config', () => {
  afterEach(() => {
    delete process.env.TEST_STRING;
    delete process.env.TEST_NUMBER;
    delete process.env.TEST_BOOL;
  });

  it('should create config with string validation', () => {
    const schema = {
      TEST_STRING: str(),
    };

    process.env.TEST_STRING = 'test-value';

    const config = createConfig(schema);

    expect(config.TEST_STRING).toBe('test-value');
  });

  it('should create config with number validation', () => {
    const schema = {
      TEST_NUMBER: num(),
    };

    process.env.TEST_NUMBER = '42';

    const config = createConfig(schema);

    expect(config.TEST_NUMBER).toBe(42);
  });

  it('should create config with boolean validation', () => {
    const schema = {
      TEST_BOOL: bool(),
    };

    process.env.TEST_BOOL = 'true';

    const config = createConfig(schema);

    expect(config.TEST_BOOL).toBe(true);
  });

  it('should update config', () => {
    const schema = {
      TEST_STRING: str(),
    };

    process.env.TEST_STRING = 'test-value';

    let config = createConfig(schema);

    config = createConfig(schema, {TEST_STRING: 'test-value2'});

    expect(config.TEST_STRING).toBe('test-value2');
  });
});

describe('fallbacks', () => {
  test('resolves defaults before chained fallback values', () => {
    const config = createConfig({
      TEST_PRIMARY_URL: fallbackTo('TEST_SECONDARY_URL', url()),
      TEST_SECONDARY_URL: fallbackTo('TEST_DEFAULT_URL', url()),
      TEST_DEFAULT_URL: url({default: 'https://default.example.test'}),
    });

    expect(config.TEST_PRIMARY_URL).toBe('https://default.example.test');
    expect(config.TEST_SECONDARY_URL).toBe('https://default.example.test');
    expectTypeOf(config.TEST_PRIMARY_URL).toEqualTypeOf<string>();
  });

  test('prefers an explicit value to its fallback', () => {
    const config = createConfig(
      {
        TEST_PRIMARY_URL: fallbackTo('TEST_SECONDARY_URL', url()),
        TEST_SECONDARY_URL: url(),
      },
      {
        TEST_PRIMARY_URL: 'https://public.example.test',
        TEST_SECONDARY_URL: 'https://internal.example.test',
      },
    );

    expect(config.TEST_PRIMARY_URL).toBe('https://public.example.test');
  });

  test('validates a fallback value with the dependent validator', () => {
    const loadConfig = () =>
      createConfig(
        {
          TEST_INPUT: str(),
          TEST_URL: fallbackTo('TEST_INPUT', url()),
        },
        {TEST_INPUT: 'not-a-url'},
      );

    expect(loadConfig).toThrow('process.exit unexpectedly called with "1"');
  });

  test('requires compatible fallback value types', () => {
    const loadConfig = () =>
      createConfig(
        // @ts-expect-error A numeric configuration value cannot fall back into a string validator.
        {
          TEST_NUMBER: num(),
          TEST_STRING: fallbackTo('TEST_NUMBER', str()),
        },
        {TEST_NUMBER: '42'},
      );

    expect(loadConfig).toThrow('process.exit unexpectedly called with "1"');
  });

  test('fails when a fallback references a missing schema key', () => {
    const loadConfig = () =>
      // @ts-expect-error The fallback key must exist in the same schema.
      createConfig({TEST_URL: fallbackTo('TEST_MISSING_URL', url())});

    expect(loadConfig).toThrow(
      'Configuration fallback for "TEST_URL" references missing key "TEST_MISSING_URL".',
    );
  });

  test('rejects a default on a key that declares a fallback', () => {
    const loadConfig = () =>
      createConfig({
        TEST_PRIMARY_URL: fallbackTo(
          'TEST_SOURCE_URL',
          url({default: 'https://public.example.test'}),
        ),
        TEST_SOURCE_URL: url({default: 'https://internal.example.test'}),
      });

    expect(loadConfig).toThrow(
      'Configuration key "TEST_PRIMARY_URL" cannot declare both a fallback and a default.',
    );
  });

  test('fails when a required fallback source has no value', () => {
    const loadConfig = () =>
      createConfig(
        {
          TEST_PRIMARY_URL: fallbackTo('TEST_SOURCE_URL', url()),
          TEST_SOURCE_URL: url(),
        },
        {TEST_PRIMARY_URL: undefined, TEST_SOURCE_URL: undefined},
      );

    expect(loadConfig).toThrow('process.exit unexpectedly called with "1"');
  });

  test('fails deterministically when fallbacks form a cycle', () => {
    const loadConfig = () =>
      createConfig({
        TEST_FIRST_URL: fallbackTo('TEST_SECOND_URL', url()),
        TEST_SECOND_URL: fallbackTo('TEST_FIRST_URL', url()),
      });

    expect(loadConfig).toThrow(
      'Configuration fallback cycle detected: TEST_FIRST_URL -> TEST_SECOND_URL -> TEST_FIRST_URL.',
    );
  });

  test('keeps missing configuration required without a fallback', () => {
    const loadConfig = () => createConfig({TEST_REQUIRED: str()}, {TEST_REQUIRED: undefined});

    expect(loadConfig).toThrow('process.exit unexpectedly called with "1"');
  });
});
