import type {DefinitionDto, DefinitionSyncSummaryDto} from '@shipfox/api-definitions-dto';
import type {
  LinkProjectConfigResponseDto,
  ListProjectConfigCommitsResponseDto,
  ListScopeResourcesResponseDto,
  ProjectConfigResponseDto,
  ReadProjectConfigFileResponseDto,
} from '@shipfox/api-integration-core-dto';
import type {ProjectAccessResponseDto, ProjectResponseDto} from '@shipfox/api-projects-dto';
import type {
  Definition,
  DefinitionList,
  DefinitionSyncSummary,
  DefinitionTrigger,
} from '#core/definition.js';
import type {Project, ProjectList} from '#core/project.js';
import type {AccessResource, ProjectAccess, ScopeResourcePage} from '#core/project-access.js';
import type {
  ConfigCommitPage,
  ConfigFile,
  ConfigFileEntry,
  ConfigMoveResult,
  ProjectConfig,
} from '#core/project-config.js';

export function toProject(dto: ProjectResponseDto): Project {
  return {
    id: dto.id,
    workspaceId: dto.workspace_id,
    name: dto.name,
    slug: dto.slug,
    isDefault: dto.is_default,
    source: {
      kind: dto.source.kind,
      connectionId: dto.source.connection_id,
      externalRepositoryId: dto.source.external_repository_id,
    },
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
  };
}

function toAccessResource(dto: {
  kind: string;
  external_id: string;
  lookup_name: string;
  display_name: string;
}): AccessResource {
  return {
    kind: dto.kind,
    externalId: dto.external_id,
    lookupName: dto.lookup_name,
    displayName: dto.display_name,
  };
}

export function toProjectAccess(dto: ProjectAccessResponseDto): ProjectAccess {
  return {
    projectId: dto.project_id,
    configSource: {
      kind: dto.config_source.kind,
      connectionId: dto.config_source.connection_id,
      externalRepositoryId: dto.config_source.external_repository_id,
      lookupName: dto.config_source.lookup_name,
    },
    connections:
      dto.connections === 'all'
        ? 'all'
        : dto.connections.map((connection) => ({
            connectionId: connection.connection_id,
            provider: connection.provider,
            displayName: connection.display_name,
            resources:
              connection.resources === 'all' ? 'all' : connection.resources.map(toAccessResource),
          })),
  };
}

export function toScopeResourcePage(dto: ListScopeResourcesResponseDto): ScopeResourcePage {
  return {resources: dto.resources.map(toAccessResource), nextCursor: dto.next_cursor};
}

export function toProjectList(dto: {
  projects: ProjectResponseDto[];
  next_cursor: string | null;
}): ProjectList {
  return {projects: dto.projects.map(toProject), nextCursor: dto.next_cursor};
}

export function toDefinition(dto: DefinitionDto): Definition {
  return {
    id: dto.id,
    projectId: dto.project_id,
    configPath: dto.config_path,
    source: dto.source,
    sha: dto.sha,
    ref: dto.ref,
    name: dto.name,
    workflowDocument: dto.workflow_document,
    workflowModel: dto.workflow_model,
    manualTrigger: dto.manual_trigger,
    triggers: toDefinitionTriggers(dto.workflow_model),
    fetchedAt: dto.fetched_at,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
  };
}

/** The list route types the model as unknown, so this reads only the trigger fields it shows. */
export function toDefinitionTriggers(workflowModel: unknown): DefinitionTrigger[] {
  if (!isRecord(workflowModel) || !Array.isArray(workflowModel.triggers)) return [];
  return workflowModel.triggers.flatMap((trigger: unknown, index: number) => {
    if (!isRecord(trigger) || typeof trigger.source !== 'string') return [];
    const schedule = isRecord(trigger.config) ? trigger.config.schedule : undefined;
    return [
      {
        key: typeof trigger.key === 'string' ? trigger.key : String(index),
        source: trigger.source,
        event: typeof trigger.event === 'string' ? trigger.event : null,
        schedule: typeof schedule === 'string' ? schedule : null,
      },
    ];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function toDefinitionSyncSummary(dto: DefinitionSyncSummaryDto): DefinitionSyncSummary {
  return {
    ref: dto.ref,
    status: dto.status,
    lastSyncAt: dto.last_sync_at,
    startedAt: dto.started_at,
    finishedAt: dto.finished_at,
    lastErrorCode: dto.last_error_code,
    lastErrorMessage: dto.last_error_message,
    diagnostics: dto.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      message: diagnostic.message,
      severity: diagnostic.severity,
      ...(diagnostic.path === undefined ? {} : {path: diagnostic.path}),
      ...(diagnostic.file_path === undefined ? {} : {filePath: diagnostic.file_path}),
    })),
  };
}

export function toDefinitionList(dto: {
  definitions: DefinitionDto[];
  sync: DefinitionSyncSummaryDto | null;
  next_cursor: string | null;
}): DefinitionList {
  return {
    definitions: dto.definitions.map(toDefinition),
    sync: dto.sync && toDefinitionSyncSummary(dto.sync),
    nextCursor: dto.next_cursor,
  };
}

export function toProjectConfig(dto: ProjectConfigResponseDto): ProjectConfig {
  return {
    source: {
      kind: dto.source.kind,
      provider: dto.source.provider,
      connectionId: dto.source.connection_id,
      externalRepositoryId: dto.source.external_repository_id,
      owner: dto.source.owner,
      name: dto.source.name,
      defaultBranch: dto.source.default_branch,
    },
    head: dto.head,
    historySupported: dto.history_supported,
    move: dto.move && {
      status: dto.move.status,
      target: {
        connectionId: dto.move.target.connection_id,
        externalRepositoryId: dto.move.target.external_repository_id,
        fullName: dto.move.target.full_name,
      },
      startedBy: dto.move.started_by,
      startedAt: dto.move.started_at,
    },
    pullRequest: dto.pull_request,
  };
}

export function toConfigMoveResult(dto: LinkProjectConfigResponseDto): ConfigMoveResult {
  return {
    repository: {
      externalRepositoryId: dto.repository.external_repository_id,
      fullName: dto.repository.full_name,
      defaultBranch: dto.repository.default_branch,
      visibility: dto.repository.visibility,
    },
    fileCount: dto.file_count,
    pullRequest: dto.pull_request,
  };
}

export function toConfigFileEntry(dto: ConfigFileEntry): ConfigFileEntry {
  return {path: dto.path, type: dto.type, size: dto.size};
}

export function toConfigFile(dto: ReadProjectConfigFileResponseDto): ConfigFile {
  return {path: dto.path, commit: dto.commit, content: dto.content};
}

export function toConfigCommitPage(dto: ListProjectConfigCommitsResponseDto): ConfigCommitPage {
  return {
    commits: dto.commits.map((commit) => ({
      oid: commit.oid,
      message: commit.message,
      authorName: commit.author_name,
      authoredAt: commit.authored_at,
      htmlUrl: commit.html_url ?? null,
    })),
    nextCursor: dto.next_cursor,
  };
}
