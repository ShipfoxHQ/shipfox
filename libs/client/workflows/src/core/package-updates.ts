/**
 * A registry package a workflow definition pins, with what the registry has newer, from
 * `GET /workspaces/:workspaceId/definitions/:definitionId/package-updates`. The notice is
 * informational: nothing changes until the user merges an upgrade.
 */
export type PackageKind = 'action' | 'template';
export type PackageBump = 'major' | 'minor' | 'patch';

export interface PackageChangelogEntry {
  version: string;
  markdown: string;
}

export interface PackageUpdate {
  kind: PackageKind;
  /** Registry package name, such as `shipfox/slack-thread-digest`. */
  package: string;
  /** The version the definition pins. */
  version: string;
  latest: string;
  behind: boolean;
  /** The highest bump over the versions after the pinned one. */
  bump: PackageBump | null;
  /** Whether a newer action version widens what the action can do. */
  capabilityChange: boolean;
  /** Steps that use the action, as `<job key>.<step key or index>`. Empty for templates. */
  steps: string[];
  /** Changelog sections of the newest versions after the pinned one, newest first. */
  changelog: PackageChangelogEntry[];
  /** The prompt to paste into a coding agent, for templates that are behind. */
  upgradePrompt: string | null;
}

/** A major template bump can remove a provider or an option the user chose, or add a required role. */
export function packageUpdateNeedsInput(update: PackageUpdate): boolean {
  return update.behind && update.kind === 'template' && update.bump === 'major';
}

export function packageUpdateChangesPermissions(update: PackageUpdate): boolean {
  return update.behind && update.kind === 'action' && update.capabilityChange;
}
