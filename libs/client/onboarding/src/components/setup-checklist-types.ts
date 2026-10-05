import type {ReactNode} from 'react';
import type {SetupChecklist, SetupChecklistItem} from '#core/setup-checklist.js';

export interface WorkspaceReference {
  id: string;
  slug: string;
}

export interface WorkspaceSetupHostProps {
  /** A stable workspace makes the hosts easy to compose in isolated surfaces and stories. */
  workspace?: WorkspaceReference;
}

export interface WorkspaceSetupChecklistProps extends WorkspaceSetupHostProps {
  /**
   * Rendered below the panel, in the same commit that mounts it, and nowhere
   * else. A dismissed checklist, a complete one with no completion to show, and
   * one still loading all render no companion, so it never stands alone.
   */
  companion?: ReactNode;
}

export interface SetupChecklistBodyProps {
  checklist: SetupChecklist;
  workspaceSlug: string;
  completion?: boolean;
  showBurst?: boolean;
  onBurstComplete?: () => void;
  onAction?: ((item: SetupChecklistItem) => void) | undefined;
  onDone?: () => void;
}
