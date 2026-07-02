import type {
  ListSecretsResponseDto,
  ListVariablesResponseDto,
  SecretDto,
  VariableDto,
} from '@shipfox/api-secrets-dto';

export const SECRETS_TEST_WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

export function secret(overrides: Partial<SecretDto> = {}): SecretDto {
  return {
    key: 'MY_TOKEN',
    project_id: null,
    created_at: '2026-05-08T00:00:00.000Z',
    updated_at: '2026-05-08T00:00:00.000Z',
    last_edited_by: '22222222-2222-4222-8222-222222222222',
    ...overrides,
  };
}

export function variable(overrides: Partial<VariableDto> = {}): VariableDto {
  return {
    ...secret(),
    key: 'LOG_LEVEL',
    value: 'debug',
    ...overrides,
  };
}

export function secretsListResponse(
  overrides: Partial<ListSecretsResponseDto> = {},
): ListSecretsResponseDto {
  return {
    secrets: [secret()],
    next_cursor: null,
    ...overrides,
  };
}

export function variablesListResponse(
  overrides: Partial<ListVariablesResponseDto> = {},
): ListVariablesResponseDto {
  return {
    variables: [variable()],
    next_cursor: null,
    ...overrides,
  };
}
