import {useCallback} from 'react';
import {RedirectInstallPage} from '#components/redirect-install-page.js';
import {useCreateLinearInstallMutation} from '#hooks/api/integrations.js';
import {saveLinearInstallWorkspace} from '#linear-callback.js';

export function LinearInstallPage() {
  const createInstall = useCreateLinearInstallMutation();
  const installRequest = useCallback(
    async (body: {workspace_id: string}) => await createInstall.mutateAsync(body),
    [createInstall],
  );

  return (
    <RedirectInstallPage
      installRequest={installRequest}
      errorFallbackMessage="Could not start Linear install."
      beforeRedirect={(workspaceId) => {
        try {
          saveLinearInstallWorkspace(window.sessionStorage, workspaceId);
        } catch {
          // Storage can be disabled before the helper gets a usable Storage object.
        }
      }}
    />
  );
}
