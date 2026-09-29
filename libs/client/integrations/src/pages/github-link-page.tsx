import {useStartGithubLink} from '#application/start-github-link.js';
import {RedirectInstallPage} from '#components/redirect-install-page.js';

/** Unlisted support route: nothing in the app links here. */
export function GithubLinkPage({assignLocation}: {assignLocation?: (url: string) => void}) {
  const startGithubLink = useStartGithubLink();
  return (
    <RedirectInstallPage
      installRequest={startGithubLink}
      errorFallbackMessage="Could not start the GitHub connection."
      loadingLabel="Connecting GitHub"
      {...(assignLocation ? {assignLocation} : {})}
    />
  );
}
