import {RedirectInstallPage} from '#components/redirect-install-page.js';
import {createGithubInstall} from '#hooks/api/integrations.js';

export function GithubInstallPage() {
  return (
    <RedirectInstallPage
      installRequest={createGithubInstall}
      errorFallbackMessage="Could not start GitHub install."
    />
  );
}
