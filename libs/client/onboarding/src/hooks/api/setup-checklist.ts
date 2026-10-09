import {
  modelProviderCatalogQueryOptions,
  modelProviderConfigsQueryOptions,
} from '@shipfox/client-agent';
import {
  type IntegrationConnection,
  type IntegrationProvider,
  integrationConnectionsQueryOptions,
  integrationProvidersQueryOptions,
} from '@shipfox/client-integrations';
import {
  activeProvisionersQueryOptions,
  installationRunnersStatusQueryOptions,
} from '@shipfox/client-runners';
import {
  listInvitationsQueryOptions,
  listMembersQueryOptions,
} from '@shipfox/client-workspace-settings';
import {useQuery} from '@tanstack/react-query';
import {
  deriveIntegrationReadiness,
  type WorkspaceIntegrationReadiness,
} from '#core/integration-readiness.js';
import {
  deriveSetupChecklist,
  type FirstWorkflowProgress,
  type SetupChecklist,
  type SetupChecklistItemId,
} from '#core/setup-checklist.js';
import {useFirstWorkflowState} from './first-workflow.js';

const CHECKLIST_STALE_TIME_MS = 5 * 60 * 1000;

export interface ChecklistQueryState {
  checklist: SetupChecklist;
  /** Undefined until the first-workflow read answers. */
  firstWorkflow: FirstWorkflowProgress | undefined;
  /** The first-workflow read answered or failed. */
  firstWorkflowSettled: boolean;
  /** Empty until the providers and connections reads answer. */
  integrations: {
    providers: readonly IntegrationProvider[];
    connections: readonly IntegrationConnection[];
    readiness: WorkspaceIntegrationReadiness;
    /** Both reads have answered once. A failed refetch keeps the last answer. */
    loaded: boolean;
  };
  baseSettled: boolean;
  /**
   * Every family that can still add a tracked row has reported, by success or
   * by failure. The teammates family is excluded: its row is a pointer, so it
   * never moves `trackedCount`.
   */
  trackedRowsSettled: boolean;
  completionReady: boolean;
  /**
   * Runners and a model are known to be available: the installation provides
   * them or the workspace set them up. False while either family is loading or
   * failed, because an unknown answer is not a yes.
   */
  canRunWorkflows: boolean;
}

/**
 * Composes the server state needed by both checklist hosts. Keeping this hook
 * in the API adapter boundary gives each query family one shared cache policy
 * while allowing dismissed hosts to remain unsubscribed.
 */
export function useSetupChecklistQueryState({
  workspaceId,
  subscribed,
  toolsStepFinished,
}: {
  workspaceId: string;
  subscribed: boolean;
  toolsStepFinished: boolean;
}): ChecklistQueryState {
  const queryEnabled = shouldEnableChecklistQueries(subscribed, workspaceId);
  const queryPolicy = {
    enabled: queryEnabled,
    subscribed: queryEnabled,
    refetchInterval: false,
    retry: false,
    staleTime: CHECKLIST_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  } as const;

  const providersQuery = useQuery({
    ...integrationProvidersQueryOptions(),
    ...queryPolicy,
  });
  const connectionsQuery = useQuery({
    ...integrationConnectionsQueryOptions(workspaceId),
    ...queryPolicy,
  });
  const activeProvisionersQuery = useQuery({
    ...activeProvisionersQueryOptions(workspaceId),
    ...queryPolicy,
  });
  const runnersStatusQuery = useQuery({
    ...installationRunnersStatusQueryOptions(workspaceId),
    ...queryPolicy,
  });
  const catalogQuery = useQuery({
    ...modelProviderCatalogQueryOptions(),
    ...queryPolicy,
  });
  const configsQuery = useQuery({
    ...modelProviderConfigsQueryOptions(workspaceId),
    ...queryPolicy,
  });
  const membersQuery = useQuery({
    ...listMembersQueryOptions(workspaceId),
    ...queryPolicy,
  });
  const invitationsQuery = useQuery({
    ...listInvitationsQueryOptions(workspaceId),
    ...queryPolicy,
  });
  // Polls on its own policy: the other families change in this app, while the
  // first workflow changes in the user's terminal and on GitHub.
  const firstWorkflow = useFirstWorkflowState({scope: {kind: 'workspace', workspaceId}});

  const families = checklistFamilyState({
    providersQuery,
    connectionsQuery,
    activeProvisionersQuery,
    runnersStatusQuery,
    catalogQuery,
    configsQuery,
    membersQuery,
    invitationsQuery,
    firstWorkflowQuery: {
      isSuccess: firstWorkflow.progress !== undefined,
      isError: firstWorkflow.isError,
    },
  });

  const providers = providersQuery.data ?? [];
  const connections = connectionsQuery.data ?? [];
  const readiness = deriveIntegrationReadiness({providers, connections});
  const rawChecklist = deriveSetupChecklist({
    readiness,
    installationRunners: runnersStatusQuery.data ?? 'managed',
    workspaceRunnerCapacity: (activeProvisionersQuery.data?.length ?? 0) > 0,
    modelProvider: {
      installationProvided: installationProviderReadiness(
        catalogQuery.isSuccess,
        hasInstallationProvider(catalogQuery.data),
      ),
      configured: (configsQuery.data?.configs.length ?? 0) > 0,
    },
    membership: {
      memberCount: membersQuery.data?.length ?? 0,
      pendingInvitationCount: invitationsQuery.data?.length ?? 0,
    },
    firstWorkflow: firstWorkflow.progress,
    toolsStepFinished,
  });

  const hiddenRows = hiddenChecklistRows(families);
  const items = rawChecklist.items.filter((item) => !hiddenRows.has(item.id));
  const trackedItems = items.filter((item) => item.tracked);
  const openCount = trackedItems.filter((item) => item.status === 'open').length;

  return {
    firstWorkflow: firstWorkflow.progress,
    firstWorkflowSettled: families.firstWorkflowSettled,
    integrations: {
      providers,
      connections,
      readiness,
      loaded: providersQuery.data !== undefined && connectionsQuery.data !== undefined,
    },
    baseSettled: families.baseSettled,
    trackedRowsSettled: families.trackedRowsSettled,
    completionReady: families.completionReady,
    canRunWorkflows: canRunWorkflows({
      runnerReady: families.runnerReady,
      modelReady: families.modelReady,
      installationRunners: runnersStatusQuery.data,
      provisionerCount: activeProvisionersQuery.data?.length ?? 0,
      catalog: catalogQuery.data,
      configCount: configsQuery.data?.configs.length ?? 0,
    }),
    checklist: {
      items,
      openCount,
      trackedCount: trackedItems.length,
      complete: families.completionReady && openCount === 0,
    },
  };
}

type SettleableQuery = {isError: boolean; isSuccess: boolean};

/**
 * Per-family readiness. A row is hidden while its family is merely loading, so
 * `ready` tracks success while `settled` also accepts a failure: a family that
 * gave up must not hold the whole checklist back.
 */
function checklistFamilyState(queries: {
  providersQuery: SettleableQuery;
  connectionsQuery: SettleableQuery;
  activeProvisionersQuery: SettleableQuery;
  runnersStatusQuery: SettleableQuery;
  catalogQuery: SettleableQuery;
  configsQuery: SettleableQuery;
  membersQuery: SettleableQuery;
  invitationsQuery: SettleableQuery;
  firstWorkflowQuery: SettleableQuery;
}) {
  const runnerSettled =
    isSettled(queries.activeProvisionersQuery) && isSettled(queries.runnersStatusQuery);
  const modelSettled = isSettled(queries.catalogQuery) && isSettled(queries.configsQuery);
  const membersSettled = isSettled(queries.membersQuery) && isSettled(queries.invitationsQuery);
  const firstWorkflowSettled = isSettled(queries.firstWorkflowQuery);
  const providersReady = queries.providersQuery.isSuccess;
  const connectionsReady = queries.connectionsQuery.isSuccess;
  const everyFamilySettled =
    runnerSettled && modelSettled && membersSettled && firstWorkflowSettled;

  return {
    providersReady,
    connectionsReady,
    runnerReady: queries.activeProvisionersQuery.isSuccess && queries.runnersStatusQuery.isSuccess,
    modelReady: queries.catalogQuery.isSuccess && queries.configsQuery.isSuccess,
    membersReady: queries.membersQuery.isSuccess && queries.invitationsQuery.isSuccess,
    firstWorkflowReady: queries.firstWorkflowQuery.isSuccess,
    firstWorkflowSettled,
    baseSettled: isSettled(queries.providersQuery) && isSettled(queries.connectionsQuery),
    trackedRowsSettled: runnerSettled && modelSettled && firstWorkflowSettled,
    completionReady: providersReady && connectionsReady && everyFamilySettled,
  };
}

function hiddenChecklistRows(readiness: {
  providersReady: boolean;
  connectionsReady: boolean;
  runnerReady: boolean;
  modelReady: boolean;
  membersReady: boolean;
  firstWorkflowReady: boolean;
  firstWorkflowSettled: boolean;
}): Set<SetupChecklistItemId> {
  const hiddenRows = new Set<SetupChecklistItemId>();
  // The tools row is tracked or a pointer depending on the first workflow, so
  // it also waits for that read. A failed read still shows it, as open.
  if (!readiness.providersReady || !readiness.connectionsReady || !readiness.firstWorkflowSettled) {
    hiddenRows.add('tools');
  }
  if (!readiness.runnerReady) hiddenRows.add('runner');
  if (!readiness.modelReady) hiddenRows.add('model-provider');
  if (!readiness.membersReady) hiddenRows.add('teammates');
  if (!readiness.firstWorkflowReady) hiddenRows.add('first-workflow');
  return hiddenRows;
}

function canRunWorkflows({
  runnerReady,
  modelReady,
  installationRunners,
  provisionerCount,
  catalog,
  configCount,
}: {
  runnerReady: boolean;
  modelReady: boolean;
  installationRunners: 'managed' | 'none' | undefined;
  provisionerCount: number;
  catalog: Parameters<typeof hasInstallationProvider>[0];
  configCount: number;
}): boolean {
  const runnersAvailable =
    runnerReady && (installationRunners === 'managed' || provisionerCount > 0);
  const modelAvailable = modelReady && (hasInstallationProvider(catalog) || configCount > 0);
  return runnersAvailable && modelAvailable;
}

function hasInstallationProvider(
  catalog: {managedProviderId: string | null; instanceDefaultProviderId: string | null} | undefined,
): boolean {
  if (catalog === undefined) return false;
  return catalog.managedProviderId !== null || catalog.instanceDefaultProviderId !== null;
}

function installationProviderReadiness(
  catalogReady: boolean,
  installationProvided: boolean,
): boolean {
  if (!catalogReady) return true;
  return installationProvided;
}

function isSettled(query: SettleableQuery) {
  return query.isSuccess || query.isError;
}

function shouldEnableChecklistQueries(subscribed: boolean, workspaceId: string): boolean {
  return subscribed && Boolean(workspaceId);
}
