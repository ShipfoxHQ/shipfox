import {
  type BrowserStorageKey,
  createTypedBrowserStorage,
  localStorageOrUndefined,
} from '@shipfox/client-ui';

const workspaceSetupToolsStepKey = {
  key: 'shipfox.workspaceSetupChecklist.toolsStepFinished',
  lifetime: 'persistent',
  principalScope: 'workspace',
  serialize: (finished: boolean) => JSON.stringify(finished),
  parse: (raw: string) => {
    try {
      const parsed: unknown = JSON.parse(raw);
      return typeof parsed === 'boolean' ? parsed : undefined;
    } catch {
      return undefined;
    }
  },
} satisfies BrowserStorageKey<boolean>;

export const WORKSPACE_SETUP_TOOLS_STEP_EVENT = 'shipfox.workspaceSetupChecklist.toolsStepChanged';

/**
 * Reads whether the tools step of the workspace home was skipped or continued
 * on this device at call time. Like the checklist dismissal, it is best effort
 * and consumers own any re-read or subscription.
 */
export function isWorkspaceSetupToolsStepFinished(workspaceId: string): boolean {
  return workspaceSetupToolsStepStorage(workspaceId).read() === true;
}

export function finishWorkspaceSetupToolsStep(workspaceId: string): void {
  workspaceSetupToolsStepStorage(workspaceId).write(true);
  dispatchWorkspaceSetupToolsStepChange();
}

export function clearWorkspaceSetupToolsStep(workspaceId: string): void {
  workspaceSetupToolsStepStorage(workspaceId).remove();
  dispatchWorkspaceSetupToolsStepChange();
}

function dispatchWorkspaceSetupToolsStepChange(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(WORKSPACE_SETUP_TOOLS_STEP_EVENT));
}

function workspaceSetupToolsStepStorage(workspaceId: string) {
  return createTypedBrowserStorage(localStorageOrUndefined, workspaceSetupToolsStepKey, {
    workspaceId,
  });
}
