import {useAuthState} from '@shipfox/client-auth';
import {useEffect, useState} from 'react';
import {useStartGithubLink} from '#application/start-github-link.js';
import {type GithubCallbackIntent, resolveGithubRecoveryWorkspace} from '#github-callback.js';
import {rememberCallbackKey} from '#workspace-navigation.js';

const startedRecoveries = new Set<string>();

/**
 * Restarts the GitHub link flow when a signed-in member lands on an incomplete
 * callback. Returns true while the redirect to GitHub is in flight.
 */
export function useGithubRecovery({
  intent,
  landingKey,
  storedWorkspaceId,
  assignLocation = (url) => window.location.assign(url),
}: {
  intent: GithubCallbackIntent;
  landingKey: string;
  storedWorkspaceId: string | undefined;
  /** Injectable for tests: jsdom's window.location cannot be stubbed. */
  assignLocation?: (url: string) => void;
}): boolean {
  const auth = useAuthState();
  const startGithubLink = useStartGithubLink();
  const [failed, setFailed] = useState(false);
  const workspaceId =
    intent.kind === 'invalid' && !auth.isLoading && auth.isAuthenticated
      ? resolveGithubRecoveryWorkspace({storedWorkspaceId, workspaces: auth.workspaces})
      : undefined;

  useEffect(() => {
    if (workspaceId === undefined || startedRecoveries.has(landingKey)) return;
    rememberCallbackKey(startedRecoveries, landingKey);
    startGithubLink({workspace_id: workspaceId}).then(
      ({installUrl}) => assignLocation(installUrl),
      () => {
        // A remounted page must retry instead of waiting on a request that never runs.
        startedRecoveries.delete(landingKey);
        setFailed(true);
      },
    );
  }, [assignLocation, landingKey, startGithubLink, workspaceId]);

  return workspaceId !== undefined && !failed;
}
