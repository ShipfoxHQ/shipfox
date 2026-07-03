import {e2eCreateSecretBodySchema, e2eCreateVariableResponseSchema} from './e2e.js';
import {
  batchSecretsBodySchema,
  batchVariablesBodySchema,
  listSecretsQuerySchema,
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

  it('requires base64url-shaped cursors', () => {
    const result = listSecretsQuerySchema.safeParse({
      cursor: 'not a cursor',
    });

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

  it('validates e2e setup payloads and responses', () => {
    const body = e2eCreateSecretBodySchema.parse({
      workspace_id: '11111111-1111-4111-8111-111111111111',
      actor_id: '22222222-2222-4222-8222-222222222222',
      key: 'API_TOKEN',
      value: 'seeded-secret',
    });
    const variable = e2eCreateVariableResponseSchema.parse({
      key: 'REGION',
      project_id: null,
      value: 'eu-west-1',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_edited_by: '22222222-2222-4222-8222-222222222222',
    });

    expect(body.key).toBe('API_TOKEN');
    expect(variable.value).toBe('eu-west-1');
  });
});
