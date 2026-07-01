import {
  batchSecretsBodySchema,
  batchVariablesBodySchema,
  listSecretsResponseSchema,
  putSecretResponseSchema,
  variableDtoSchema,
} from './management.js';

describe('management schemas', () => {
  it('does not allow secret values or fingerprints in secret DTOs', () => {
    const result = listSecretsResponseSchema.parse({
      secrets: [
        {
          key: 'API_TOKEN',
          project_id: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          last_edited_by: null,
          value: 'secret',
          fingerprint: 'hmac',
        },
      ],
      next_cursor: null,
    });

    expect(result.secrets[0]).toEqual({
      key: 'API_TOKEN',
      project_id: null,
      created_at: expect.any(String),
      updated_at: expect.any(String),
      last_edited_by: null,
    });
  });

  it('includes variable values in variable DTOs', () => {
    const result = variableDtoSchema.parse({
      key: 'NODE_ENV',
      project_id: null,
      value: 'test',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_edited_by: null,
    });

    expect(result.value).toBe('test');
  });

  it('requires batch entries to be non-empty', () => {
    const result = batchSecretsBodySchema.safeParse({entries: []});

    expect(result.success).toBe(false);
  });

  it('rejects duplicate batch keys', () => {
    const secretsResult = batchSecretsBodySchema.safeParse({
      entries: [
        {key: 'API_TOKEN', value: 'short'},
        {key: 'API_TOKEN', value: 'long-enough-secret'},
      ],
    });
    const variablesResult = batchVariablesBodySchema.safeParse({
      entries: [
        {key: 'REGION', value: 'us-east-1'},
        {key: 'REGION', value: 'eu-west-1'},
      ],
    });

    expect(secretsResult.success).toBe(false);
    expect(variablesResult.success).toBe(false);
  });

  it('accepts advisory warning payloads on write responses', () => {
    const result = putSecretResponseSchema.parse({
      secret: {
        key: 'API_TOKEN',
        project_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_edited_by: null,
      },
      warnings: [{code: 'short-secret-value', key: 'API_TOKEN'}],
    });

    expect(result.warnings).toEqual([{code: 'short-secret-value', key: 'API_TOKEN'}]);
  });
});
