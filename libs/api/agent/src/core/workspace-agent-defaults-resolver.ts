import {
  DEFAULT_HARNESS,
  type ManagedModelProvider,
  type WorkspaceProvidersPolicy,
} from '@shipfox/api-agent-dto';
import type {AgentValidationCatalogV2} from '@shipfox/api-agent-dto/inter-module';
import {getAgentWorkspaceDefaultsSnapshot, getAgentWorkspaceSettings} from '#db/index.js';
import {getManagedModelLocks} from './managed-model-locks.js';
import type {AgentDefaultsResolver} from './resolve-agent-config.js';
import {resolveAgentConfig} from './resolve-agent-config.js';
import {getAgentValidationCatalogV2} from './validation-catalog.js';
import {workspaceAgentResolutionContext} from './workspace-agent-context.js';

export async function getWorkspaceAgentValidationCatalog(
  workspaceId: string,
  managedProvider?: ManagedModelProvider | undefined,
  workspaceProviders?: WorkspaceProvidersPolicy | undefined,
): Promise<AgentValidationCatalogV2> {
  const [settings, locks] = await Promise.all([
    getAgentWorkspaceSettings(workspaceId),
    getManagedModelLocks(managedProvider, workspaceId),
  ]);
  const catalog = getAgentValidationCatalogV2(
    managedProvider,
    workspaceProviders,
    settings?.defaultHarnessId ?? DEFAULT_HARNESS,
  );
  if (managedProvider === undefined || locks.size === 0) return catalog;
  return {...catalog, locked_model_ids_by_provider: {[managedProvider.id]: [...locks.keys()]}};
}

export async function createWorkspaceAgentDefaultsResolver(
  workspaceId: string,
  managedProvider?: ManagedModelProvider | undefined,
  workspaceProviders?: WorkspaceProvidersPolicy | undefined,
): Promise<AgentDefaultsResolver> {
  const snapshot = await getAgentWorkspaceDefaultsSnapshot(workspaceId);
  const ctx = workspaceAgentResolutionContext(snapshot, managedProvider, workspaceProviders);

  return (step) => resolveAgentConfig(step, ctx);
}
