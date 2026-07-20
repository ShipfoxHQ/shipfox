import {RedirectInstallPage} from '#components/redirect-install-page.js';
import {createSentryInstall} from '#hooks/api/integrations.js';
import {saveSentryInstallWorkspace} from '#sentry-callback.js';

export function SentryInstallPage() {
  return (
    <RedirectInstallPage
      installRequest={createSentryInstall}
      errorFallbackMessage="Could not start Sentry install."
      loadingLabel="Connecting Sentry"
      // Sentry's redirect has no state param; the stored id lets the callback
      // pre-select this workspace. Saving never throws (see helper).
      beforeRedirect={(workspaceId) => {
        saveSentryInstallWorkspace(window.sessionStorage, workspaceId);
      }}
    />
  );
}
