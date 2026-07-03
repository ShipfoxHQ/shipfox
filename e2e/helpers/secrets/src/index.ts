import type {
  E2eCreateSecretBodyDto,
  E2eCreateSecretResponseDto,
  E2eCreateVariableBodyDto,
  E2eCreateVariableResponseDto,
} from '@shipfox/api-secrets-dto';
import {requestJson} from '@shipfox/e2e-core';

export type {
  E2eCreateSecretBodyDto,
  E2eCreateSecretResponseDto,
  E2eCreateVariableBodyDto,
  E2eCreateVariableResponseDto,
} from '@shipfox/api-secrets-dto';

export interface CreateSecretParams {
  workspaceId: string;
  actorId: string;
  key: string;
  value: string;
  projectId?: string | undefined;
}

export interface CreateVariableParams {
  workspaceId: string;
  actorId: string;
  key: string;
  value: string;
  projectId?: string | undefined;
}

function secretBody(params: CreateSecretParams): E2eCreateSecretBodyDto {
  return {
    workspace_id: params.workspaceId,
    actor_id: params.actorId,
    key: params.key,
    value: params.value,
    ...(params.projectId ? {project_id: params.projectId} : {}),
  };
}

function variableBody(params: CreateVariableParams): E2eCreateVariableBodyDto {
  return {
    workspace_id: params.workspaceId,
    actor_id: params.actorId,
    key: params.key,
    value: params.value,
    ...(params.projectId ? {project_id: params.projectId} : {}),
  };
}

export async function createSecret(
  params: CreateSecretParams,
): Promise<E2eCreateSecretResponseDto> {
  return await requestJson<E2eCreateSecretResponseDto>('post', '/__e2e/secrets/secret', {
    json: secretBody(params),
  });
}

export async function createVariable(
  params: CreateVariableParams,
): Promise<E2eCreateVariableResponseDto> {
  return await requestJson<E2eCreateVariableResponseDto>('post', '/__e2e/secrets/variable', {
    json: variableBody(params),
  });
}

export function createSecretsHelper() {
  return {
    createSecret,
    createVariable,
  };
}

export type SecretsHelper = ReturnType<typeof createSecretsHelper>;

export interface SecretsFixtures {
  secrets: SecretsHelper;
}

export const secretsHelper = {
  secrets: async (
    {request: _request}: {request: unknown},
    use: (helper: SecretsHelper) => Promise<void>,
  ) => {
    await use(createSecretsHelper());
  },
};
