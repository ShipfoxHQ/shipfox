import type {
  CreateE2eGithubConnectionBodyDto,
  CreateE2eGithubConnectionResponseDto,
} from '@shipfox/api-integration-github-dto';
import type {
  CreateE2eLinearConnectionBodyDto,
  CreateE2eLinearConnectionResponseDto,
} from '@shipfox/api-integration-linear-dto';
import {requestJson} from '@shipfox/e2e-core';

export type {
  CreateE2eGithubConnectionBodyDto,
  CreateE2eGithubConnectionResponseDto,
} from '@shipfox/api-integration-github-dto';
export type {
  CreateE2eLinearConnectionBodyDto,
  CreateE2eLinearConnectionResponseDto,
} from '@shipfox/api-integration-linear-dto';

export interface CreateGithubConnectionParams {
  workspaceId: string;
  installationId: number;
  accountLogin: string;
  displayName: string;
  installerUserId: string;
}

function githubConnectionBody(
  params: CreateGithubConnectionParams,
): CreateE2eGithubConnectionBodyDto {
  return {
    workspace_id: params.workspaceId,
    installation_id: params.installationId,
    account_login: params.accountLogin,
    display_name: params.displayName,
    installer_user_id: params.installerUserId,
  };
}

export async function createGithubConnection(
  params: CreateGithubConnectionParams,
): Promise<CreateE2eGithubConnectionResponseDto> {
  return await requestJson<CreateE2eGithubConnectionResponseDto>(
    'post',
    '/__e2e/integrations/github-connections',
    {json: githubConnectionBody(params)},
  );
}

export interface CreateLinearConnectionParams {
  workspaceId: string;
  organizationId: string;
  organizationUrlKey: string;
  appUserId: string;
  displayName: string;
  accessToken: string;
  scopes?: string[] | undefined;
}

function linearConnectionBody(
  params: CreateLinearConnectionParams,
): CreateE2eLinearConnectionBodyDto {
  return {
    workspace_id: params.workspaceId,
    organization_id: params.organizationId,
    organization_url_key: params.organizationUrlKey,
    app_user_id: params.appUserId,
    display_name: params.displayName,
    access_token: params.accessToken,
    scopes: params.scopes ?? ['read', 'write'],
  };
}

export async function createLinearConnection(
  params: CreateLinearConnectionParams,
): Promise<CreateE2eLinearConnectionResponseDto> {
  return await requestJson<CreateE2eLinearConnectionResponseDto>(
    'post',
    '/__e2e/integrations/linear-connections',
    {json: linearConnectionBody(params)},
  );
}
