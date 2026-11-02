import type {
  ListProjectConfigCommitsResponseDto,
  ListProjectConfigFilesResponseDto,
  ProjectConfigResponseDto,
} from '@shipfox/api-integration-core-dto';
import type {ConfigSource, ProjectConfigService} from '#core/project-config-service.js';

type ConfigFilesResult = Awaited<ReturnType<ProjectConfigService['listConfigFiles']>>;
type ConfigCommitsResult = Awaited<ReturnType<ProjectConfigService['listConfigCommits']>>;

export function toProjectConfigDto({
  source,
  head,
  historySupported,
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
