import type {
  LinkProjectConfigResponseDto,
  ListProjectConfigCommitsResponseDto,
  ListProjectConfigFilesResponseDto,
  ProjectConfigResponseDto,
} from '@shipfox/api-integration-core-dto';
import type {LinkConfigResult} from '#core/config-link-service.js';
import type {ConfigSource, ProjectConfigService} from '#core/project-config-service.js';

type ConfigFilesResult = Awaited<ReturnType<ProjectConfigService['listConfigFiles']>>;
type ConfigCommitsResult = Awaited<ReturnType<ProjectConfigService['listConfigCommits']>>;

export function toProjectConfigDto({
  source,
  head,
  historySupported,
  move,
  pullRequest,
}: ConfigSource): ProjectConfigResponseDto {
  return {
    source: {
      kind: source.kind,
      provider: source.provider,
      connection_id: source.connectionId,
      external_repository_id: source.externalRepositoryId,
      owner: source.owner,
      name: source.name,
      default_branch: source.defaultBranch,
    },
    head,
    history_supported: historySupported,
    move: move && {
      status: move.status,
      target: {
        connection_id: move.target.connectionId,
        external_repository_id: move.target.externalRepositoryId,
        full_name: move.target.fullName,
      },
      started_by: move.startedBy,
      started_at: move.startedAt,
    },
    pull_request: pullRequest,
  };
}

export function toLinkProjectConfigDto(result: LinkConfigResult): LinkProjectConfigResponseDto {
  return {
    status: result.status,
    repository: {
      external_repository_id: result.repository.externalRepositoryId,
      full_name: result.repository.fullName,
      default_branch: result.repository.defaultBranch,
      visibility: result.repository.visibility,
    },
    file_count: result.fileCount,
    pull_request: result.pullRequest,
  };
}

export function toProjectConfigFilesDto(
  result: ConfigFilesResult,
): ListProjectConfigFilesResponseDto {
  return {commit: result.commit, files: result.files, next_cursor: result.nextCursor};
}

export function toProjectConfigCommitsDto(
  result: ConfigCommitsResult,
): ListProjectConfigCommitsResponseDto {
  return {
    commit: result.commit,
    commits: result.commits.map((commit) => ({
      oid: commit.oid,
      message: commit.message,
      author_name: commit.authorName,
      authored_at: commit.authoredAt.toISOString(),
      ...(commit.htmlUrl === undefined ? {} : {html_url: commit.htmlUrl}),
    })),
    next_cursor: result.nextCursor,
  };
}
