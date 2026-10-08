import type {FeatureFlags} from '@shipfox/node-feature-flags';
import {definitionRegistryConfigured} from '../config.js';
import {definitionsFlags} from '../flags.js';

export interface ActionSupport {
  /** Accepts action steps (`uses`). */
  actionsEnabled: boolean;
  /** Accepts registry references in `uses`. On when actions are on and `REGISTRY_URL` is set. */
  registryActionsEnabled: boolean;
}

export function actionSupportFor(actionsEnabled: boolean): ActionSupport {
  return {actionsEnabled, registryActionsEnabled: actionsEnabled && definitionRegistryConfigured};
}

/**
 * Reads the `definitions-actions` flag for the workspace, or globally when there
 * is none. An explicit `actionsEnabled` skips the read, and an explicit
 * `registryActionsEnabled` replaces the derived value. Without `flags` the
 * flag's default applies.
 */
export async function readActionSupport(params: {
  flags: FeatureFlags | undefined;
  workspaceId: string | null | undefined;
  actionsEnabled?: boolean | undefined;
  registryActionsEnabled?: boolean | undefined;
}): Promise<ActionSupport> {
  const actionsEnabled =
    params.actionsEnabled ??
    (params.flags === undefined
      ? definitionsFlags['definitions-actions'].default
      : await params.flags.boolean(
          definitionsFlags['definitions-actions'],
          params.workspaceId == null ? {} : {workspaceId: params.workspaceId},
        ));
  const support = actionSupportFor(actionsEnabled);
  return {
    actionsEnabled,
    registryActionsEnabled: params.registryActionsEnabled ?? support.registryActionsEnabled,
  };
}
