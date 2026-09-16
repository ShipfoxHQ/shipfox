import {sessionStorageOrUndefined} from '@shipfox/client-ui';
import {RedirectInstallPage} from '#components/redirect-install-page.js';
import {saveGithubInstallWorkspace} from '#github-callback.js';
import {createGithubInstall} from '#hooks/api/integrations.js';

export function GithubInstallPage() {
  return (
    <RedirectInstallPage
      installRequest={createGithubInstall}
      errorFallbackMessage="Could not start GitHub install."
      beforeRedirect={(workspaceId) => {
        saveGithubInstallWorkspace(sessionStorageOrUndefined(), workspaceId);
      }}
    />
  );
}
