import {isManagedRepositoryId} from '@shipfox/api-integration-managed-vcs-dto';
import type {ProjectAccessResponseDto} from '@shipfox/api-projects-dto';
import type {ProjectAccessView} from '#core/project-access.js';

export interface ConnectionLabel {
  provider: string;
  displayName: string;
}

export function toProjectAccessDto(
  view: ProjectAccessView,
  labels: ReadonlyMap<string, ConnectionLabel>,
): ProjectAccessResponseDto {
  const {project, access, policy} = view;
  return {
    project_id: project.id,
    config_source: {
      kind: isManagedRepositoryId(project.sourceExternalRepositoryId) ? 'managed' : 'linked',
      connection_id: policy.configSource.connectionId,
      external_repository_id: policy.configSource.externalRepositoryId,
      lookup_name: policy.configSource.lookupName,
    },
    connections:
      access.connectionAccess === 'all'
        ? 'all'
        : access.scopes.map((scope) => {
            const label = labels.get(scope.connectionId);
            return {
              connection_id: scope.connectionId,
              provider: label?.provider ?? null,
              display_name: label?.displayName ?? null,
              resources:
                scope.resources === 'all'
                  ? ('all' as const)
                  : scope.resources.map((resource) => ({
                      kind: resource.kind,
                      external_id: resource.externalId,
                      lookup_name: resource.lookupName,
                      display_name: resource.displayName,
                    })),
            };
          }),
  };
}
