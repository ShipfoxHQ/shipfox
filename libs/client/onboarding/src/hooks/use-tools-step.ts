import {
  finishWorkspaceSetupToolsStep,
  isWorkspaceSetupToolsStepFinished,
  WORKSPACE_SETUP_TOOLS_STEP_EVENT,
} from '@shipfox/client-shell/runtime';
import {useCallback, useEffect, useState} from 'react';

/**
 * Per-device flag for the tools step of the home: set once the reader skips or
 * continues. It follows storage and focus like the dismissal, so both hosts and
 * other tabs agree on the tools row.
 */
export function useToolsStep(workspaceId: string) {
  const [finished, setFinished] = useState(() => isWorkspaceSetupToolsStepFinished(workspaceId));

  useEffect(() => {
    const refresh = () => setFinished(isWorkspaceSetupToolsStepFinished(workspaceId));
    refresh();
    window.addEventListener('storage', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener(WORKSPACE_SETUP_TOOLS_STEP_EVENT, refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener(WORKSPACE_SETUP_TOOLS_STEP_EVENT, refresh);
    };
  }, [workspaceId]);

  const finish = useCallback(() => {
    finishWorkspaceSetupToolsStep(workspaceId);
    setFinished(true);
  }, [workspaceId]);

  return {finished, finish};
}
