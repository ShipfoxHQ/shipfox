import {type PackageUpdateDto, packageUpdatesResponseSchema} from '@shipfox/api-definitions-dto';
import {checkedApiRequest} from '@shipfox/client-api';
import {queryOptions, useQuery} from '@tanstack/react-query';
import type {PackageUpdate} from '#core/package-updates.js';

export const packageUpdatesQueryKeys = {
  all: ['package-updates'] as const,
  definition: (workspaceId: string, definitionId: string) =>
    [...packageUpdatesQueryKeys.all, workspaceId, definitionId] as const,
};

export async function listPackageUpdates({
  workspaceId,
  definitionId,
  signal,
}: {
  workspaceId: string;
  definitionId: string;
  signal?: AbortSignal;
}): Promise<PackageUpdate[]> {
  const response = await checkedApiRequest(
    packageUpdatesResponseSchema,
    `/workspaces/${workspaceId}/definitions/${definitionId}/package-updates`,
    {signal},
  );
  return response.updates.map(toPackageUpdate);
}

function toPackageUpdate(update: PackageUpdateDto): PackageUpdate {
  return {
    kind: update.kind,
    package: update.package,
    version: update.version,
    latest: update.latest,
    behind: update.behind,
    bump: update.bump,
    capabilityChange: update.capability_change ?? false,
    steps: update.steps ?? [],
    changelog: update.changelog,
    upgradePrompt: update.upgrade_prompt ?? null,
  };
}

export function packageUpdatesQueryOptions(workspaceId: string, definitionId: string) {
  return queryOptions({
    queryKey: packageUpdatesQueryKeys.definition(workspaceId, definitionId),
    queryFn: ({signal}) => listPackageUpdates({workspaceId, definitionId, signal}),
  });
}

export function usePackageUpdatesQuery(workspaceId: string, definitionId: string) {
  return useQuery(packageUpdatesQueryOptions(workspaceId, definitionId));
}
