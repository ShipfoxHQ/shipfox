import type {SecretsInterModuleClient} from '@shipfox/api-secrets-dto/inter-module';

export type AgentSecretsClient = Pick<
  SecretsInterModuleClient,
  'deleteSecrets' | 'getSecretsByNamespace' | 'setSecrets'
>;

export function requireAgentSecretsClient(
  secrets: AgentSecretsClient | undefined,
): AgentSecretsClient {
  if (secrets) return secrets;
  throw new Error('Agent Secrets client is not configured.');
}
