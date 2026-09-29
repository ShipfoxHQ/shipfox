import {z} from 'zod';

/** Each changelog entry is cut to this many characters, so the notice stays small. */
export const PACKAGE_UPDATE_CHANGELOG_ENTRY_MAX_LENGTH = 2000;
/** The newest versions between the pinned and the latest one whose changelog the notice carries. */
export const PACKAGE_UPDATE_CHANGELOG_MAX_ENTRIES = 5;

export const packageUpdateChangelogEntrySchema = z.object({
  version: z.string(),
  markdown: z.string().max(PACKAGE_UPDATE_CHANGELOG_ENTRY_MAX_LENGTH),
});

export type PackageUpdateChangelogEntryDto = z.infer<typeof packageUpdateChangelogEntrySchema>;

export const packageUpdateSchema = z.object({
  kind: z.enum(['action', 'template']),
  /** Registry package name, such as `shipfox/slack-thread-digest`. */
  package: z.string(),
  /** The version the definition pins. */
  version: z.string(),
  /** The highest version the registry lists. */
  latest: z.string(),
  behind: z.boolean(),
  /** The highest bump over the versions after the pinned one, or `null` when none is newer. */
  bump: z.enum(['major', 'minor', 'patch']).nullable(),
  /** Whether a newer version widens what the action can do. Set for actions only. */
  capability_change: z.boolean().optional(),
  /** Steps that use the action, as `<job key>.<step key or index>`. Set for actions only. */
  steps: z.array(z.string()).optional(),
  /** Changelog sections of the newest versions after the pinned one, newest first. */
  changelog: z.array(packageUpdateChangelogEntrySchema).max(PACKAGE_UPDATE_CHANGELOG_MAX_ENTRIES),
  /** The prompt to paste into a coding agent. Set for templates that are behind. */
  upgrade_prompt: z.string().optional(),
});

export type PackageUpdateDto = z.infer<typeof packageUpdateSchema>;

export const packageUpdatesResponseSchema = z.object({
  updates: z.array(packageUpdateSchema),
});

export type PackageUpdatesResponseDto = z.infer<typeof packageUpdatesResponseSchema>;
