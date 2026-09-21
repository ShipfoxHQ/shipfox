import type {SecretsInterModuleClient} from '@shipfox/api-secrets-dto/inter-module';
import {SecretInputNotFoundError} from './errors.js';

export interface SecretInputSource {
  key: string;
  projectId: string | null;
}

export interface SecretInputReference {
  store: 'local';
  key: string;
  projectId: string | null;
}

export async function pinSecretInputs(params: {
  secrets: Pick<SecretsInterModuleClient, 'getSecret'>;
  workspaceId: string;
  resolutionProjectId: string | null;
  secretInputs: Record<string, string> | Record<string, SecretInputSource>;
}): Promise<Record<string, SecretInputReference>> {
  const pinned: Record<string, SecretInputReference> = {};

  for (const [name, input] of Object.entries(params.secretInputs)) {
    const source =
      typeof input === 'string' ? {key: input, projectId: params.resolutionProjectId} : input;
    const result = await params.secrets.getSecret({
      workspaceId: params.workspaceId,
      projectId: source.projectId,
      namespace: '',
      key: source.key,
      store: 'local',
    });
    if (result.value === null) throw new SecretInputNotFoundError(source.key);

    pinned[name] = {store: 'local', key: source.key, projectId: result.projectId};
  }

  return pinned;
}
