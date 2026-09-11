import {sessionStorageOrUndefined} from '@shipfox/client-ui';
import {useCallback} from 'react';
import {saveClickUpInstallWorkspace} from '#clickup-callback.js';
import {RedirectInstallPage} from '#components/redirect-install-page.js';
import {useCreateClickUpInstallMutation} from '#hooks/api/integrations.js';

export function ClickUpInstallPage() {
  const createInstall = useCreateClickUpInstallMutation();
  const installRequest = useCallback(
    async (body: {workspace_id: string}) => await createInstall.mutateAsync(body),
    [createInstall],
  );

  return (
    <RedirectInstallPage
      installRequest={installRequest}
      errorFallbackMessage="Could not start ClickUp install."
      loadingLabel="Connecting ClickUp"
      beforeRedirect={(workspaceId) => {
        try {
          saveClickUpInstallWorkspace(sessionStorageOrUndefined(), workspaceId);
        } catch {
          // Storage can be disabled before the helper gets a usable Storage object.
        }
      }}
    />
  );
}
