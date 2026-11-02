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

export const projectConfigResponseSchema = z.object({
  source: projectConfigSourceDtoSchema,
  /** Null while the provider can't answer, so the source header still renders. */
  head: z.object({ref: z.string(), commit: z.string()}).nullable(),
  history_supported: z.boolean(),
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
