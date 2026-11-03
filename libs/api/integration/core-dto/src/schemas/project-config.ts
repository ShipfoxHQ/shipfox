import {isSafeRefInput} from '@shipfox/regex';
import {z} from 'zod';

/** Every config read stays under this directory of the project's repository. */
export const CONFIG_ROOT = '.shipfox';
export const CONFIG_PATH_MAX_LENGTH = 1024;

function isConfigPath(path: string, options: {allowRoot: boolean}): boolean {
  if (path === CONFIG_ROOT) return options.allowRoot;
  if (!path.startsWith(`${CONFIG_ROOT}/`) || path.includes('\\') || !isSafeRefInput(path)) {
    return false;
  }
  return path
    .split('/')
    .every(
      (segment) => segment !== '' && segment !== '.' && segment !== '..' && segment !== '.git',
    );
}

/** A file inside `.shipfox/`. */
export const configFilePathSchema = z
  .string()
  .max(CONFIG_PATH_MAX_LENGTH)
  .refine((path) => isConfigPath(path, {allowRoot: false}), 'Path must be a file under .shipfox/');
/** A file or folder inside `.shipfox/`, or `.shipfox` itself for every config change. */
export const configHistoryPathSchema = z
  .string()
  .max(CONFIG_PATH_MAX_LENGTH)
  .refine((path) => isConfigPath(path, {allowRoot: true}), 'Path must be .shipfox or inside it');

export const configSourceKindSchema = z.enum(['managed', 'linked']);

const projectParams = z.object({projectId: z.string().uuid()});
const refQuery = z.string().min(1).refine(isSafeRefInput, 'Ref contains a control character');

export const getProjectConfigParamsSchema = projectParams;
export type GetProjectConfigParamsDto = z.infer<typeof getProjectConfigParamsSchema>;

export const projectConfigSourceDtoSchema = z.object({
  kind: configSourceKindSchema,
  provider: z.string().min(1),
  connection_id: z.string().uuid(),
  external_repository_id: z.string(),
  owner: z.string().nullable(),
  name: z.string().nullable(),
  default_branch: z.string(),
});
export type ProjectConfigSourceDto = z.infer<typeof projectConfigSourceDtoSchema>;

export const configMoveStatusSchema = z.enum(['linking', 'linked']);
export const configPullRequestStateSchema = z.enum(['open', 'merged', 'closed']);

/** A move to a repository that is running, stopped, or finished with a pull request to merge. */
export const projectConfigMoveDtoSchema = z.object({
  status: configMoveStatusSchema,
  target: z.object({
    connection_id: z.string().uuid(),
    external_repository_id: z.string(),
    /** Null when the provider can't answer, or once the move is no longer running. */
    full_name: z.string().nullable(),
  }),
  started_by: z.string().nullable(),
  started_at: z.string().datetime().nullable(),
});
export type ProjectConfigMoveDto = z.infer<typeof projectConfigMoveDtoSchema>;

export const projectConfigPullRequestDtoSchema = z.object({
  url: z.string(),
  number: z.number().int(),
  /** `unknown` while the provider can't answer. */
  state: z.union([configPullRequestStateSchema, z.literal('unknown')]),
});
export type ProjectConfigPullRequestDto = z.infer<typeof projectConfigPullRequestDtoSchema>;

export const projectConfigResponseSchema = z.object({
  source: projectConfigSourceDtoSchema,
  /** Null while the provider can't answer, so the source header still renders. */
  head: z.object({ref: z.string(), commit: z.string()}).nullable(),
  history_supported: z.boolean(),
  /** Null unless the project moved, or is moving, from a managed repository. */
  move: projectConfigMoveDtoSchema.nullable(),
  /** Null once the pull request merged, or when the move opened none. */
  pull_request: projectConfigPullRequestDtoSchema.nullable(),
});
export type ProjectConfigResponseDto = z.infer<typeof projectConfigResponseSchema>;

export const listProjectConfigFilesParamsSchema = projectParams;
export const listProjectConfigFilesQuerySchema = z.object({
  /** A commit id from `head`, or a ref. Defaults to the default branch. */
  ref: refQuery.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  cursor: z.string().min(1).optional(),
});
export type ListProjectConfigFilesQueryDto = z.infer<typeof listProjectConfigFilesQuerySchema>;

export const projectConfigFileEntryDtoSchema = z.object({
  path: z.string(),
  type: z.enum(['file', 'symlink', 'submodule']),
  size: z.number().int().nullable(),
});
export const listProjectConfigFilesResponseSchema = z.object({
  commit: z.string(),
  files: z.array(projectConfigFileEntryDtoSchema),
  next_cursor: z.string().nullable(),
});
export type ListProjectConfigFilesResponseDto = z.infer<
  typeof listProjectConfigFilesResponseSchema
>;

/** The file path is the rest of the URL after `/config/files/`. */
export const readProjectConfigFileParamsSchema = projectParams.extend({
  '*': configFilePathSchema,
});
export const readProjectConfigFileQuerySchema = z.object({ref: refQuery.optional()});
export type ReadProjectConfigFileQueryDto = z.infer<typeof readProjectConfigFileQuerySchema>;
export const readProjectConfigFileResponseSchema = z.object({
  path: z.string(),
  commit: z.string(),
  content: z.string(),
});
export type ReadProjectConfigFileResponseDto = z.infer<typeof readProjectConfigFileResponseSchema>;

export const listProjectConfigCommitsParamsSchema = projectParams;
export const listProjectConfigCommitsQuerySchema = z.object({
  path: configHistoryPathSchema.default(CONFIG_ROOT),
  ref: refQuery.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});
export type ListProjectConfigCommitsQueryDto = z.infer<typeof listProjectConfigCommitsQuerySchema>;

export const projectConfigCommitDtoSchema = z.object({
  oid: z.string(),
  message: z.string(),
  author_name: z.string(),
  authored_at: z.string().datetime(),
  /** Set by providers with their own commit page. */
  html_url: z.string().optional(),
});
export const listProjectConfigCommitsResponseSchema = z.object({
  commit: z.string(),
  commits: z.array(projectConfigCommitDtoSchema),
  next_cursor: z.string().nullable(),
});
export type ListProjectConfigCommitsResponseDto = z.infer<
  typeof listProjectConfigCommitsResponseSchema
>;

export const linkProjectConfigParamsSchema = projectParams;
export const linkProjectConfigBodySchema = z.object({
  connection_id: z.string().uuid(),
  external_repository_id: z.string().min(1),
  /** Runs the checks only. */
  dry_run: z.boolean().default(false),
});
export type LinkProjectConfigBodyDto = z.infer<typeof linkProjectConfigBodySchema>;

const pullRequestSummarySchema = z.object({
  url: z.string(),
  number: z.number().int(),
  state: configPullRequestStateSchema,
});
export const linkProjectConfigResponseSchema = z.object({
  /** `ready` after a dry run that passed the checks. */
  status: z.enum(['ready', 'linked']),
  repository: z.object({
    external_repository_id: z.string(),
    full_name: z.string(),
    default_branch: z.string(),
    visibility: z.enum(['public', 'private', 'internal', 'unknown']),
  }),
  file_count: z.number().int(),
  /** Null after a dry run, and when the config had no files to add. */
  pull_request: pullRequestSummarySchema.nullable(),
});
export type LinkProjectConfigResponseDto = z.infer<typeof linkProjectConfigResponseSchema>;

export const openProjectConfigPullRequestParamsSchema = projectParams;
export const openProjectConfigPullRequestResponseSchema = z.object({
  pull_request: pullRequestSummarySchema,
});
export type OpenProjectConfigPullRequestResponseDto = z.infer<
  typeof openProjectConfigPullRequestResponseSchema
>;
