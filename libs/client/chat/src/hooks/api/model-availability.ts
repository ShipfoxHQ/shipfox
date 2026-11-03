import {
  type getModelProviderCatalog,
  modelProviderCatalogQueryOptions,
  modelProviderConfigsQueryOptions,
} from '@shipfox/client-agent';
import type {RequiredAction} from '@shipfox/policy-notice';
import {useQuery} from '@tanstack/react-query';

export interface UnavailableModel {
  label: string;
  message: string | undefined;
  action: RequiredAction | undefined;
}

export interface ChatModelAvailability {
  /** An installation provider, or a provider the workspace configured. */
  hasModel: boolean;
  /** Why a turn's model can't run, when the catalog marks it locked. */
  unavailableModel: (params: {
    provider: string | null;
    model: string | null;
  }) => UnavailableModel | undefined;
}

/** Whether Shippy has a model to reply with. Members can read both resources. */
export function useChatModelAvailability(workspaceId: string): ChatModelAvailability {
  const catalogQuery = useQuery(modelProviderCatalogQueryOptions(workspaceId));
  const configsQuery = useQuery(modelProviderConfigsQueryOptions(workspaceId));
  const catalog = catalogQuery.data;
  const configs = configsQuery.data?.configs ?? [];

  return {
    hasModel:
      // A failed read must not hide the composer, so only a settled read can say there's none.
      !(catalogQuery.isSuccess && configsQuery.isSuccess) ||
      catalog?.managedProviderId != null ||
      catalog?.instanceDefaultProviderId != null ||
      configs.length > 0,
    unavailableModel: ({provider, model}) =>
      catalog && model ? findModel({catalog, provider, model}) : undefined,
  };
}

type Catalog = Awaited<ReturnType<typeof getModelProviderCatalog>>;

function findModel(params: {
  catalog: Catalog;
  provider: string | null;
  model: string;
}): UnavailableModel {
  const {catalog, provider, model} = params;
  for (const entry of catalog.providers) {
    if (entry.kind !== 'supported' || (provider !== null && entry.id !== provider)) continue;
    const found = entry.models.find((candidate) => candidate.id === model);
    if (!found) continue;
    return {
      label: found.label,
      message: found.locked?.message,
      action: found.locked?.action,
    };
  }
  return {label: model, message: undefined, action: undefined};
}
