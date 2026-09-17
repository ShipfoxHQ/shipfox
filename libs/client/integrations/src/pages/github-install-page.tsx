import {sessionStorageOrUndefined} from '@shipfox/client-ui';
import {RedirectInstallPage} from '#components/redirect-install-page.js';
import {clearGithubInstallWorkspace, saveGithubInstallWorkspace} from '#github-callback.js';
import {createGithubInstall} from '#hooks/api/integrations.js';

export function GithubInstallPage() {
  return (
    <RedirectInstallPage
      installRequest={createGithubInstallWithFailureCleanup}
      errorFallbackMessage="Could not start GitHub install."
      beforeRedirect={(workspaceId) => {
        saveGithubInstallWorkspace(sessionStorageOrUndefined(), workspaceId);
      }}
    />
  );
}

async function createGithubInstallWithFailureCleanup(
  input: Parameters<typeof createGithubInstall>[0],
) {
  try {
    return await createGithubInstall(input);
  } catch (error) {
    clearGithubInstallWorkspace(sessionStorageOrUndefined());
    throw error;
  }
}
