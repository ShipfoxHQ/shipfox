import {sessionStorageOrUndefined} from '@shipfox/client-ui';
import {useCallback} from 'react';
import {RedirectInstallPage} from '#components/redirect-install-page.js';
import {useCreateSlackInstallMutation} from '#hooks/api/integrations.js';
import {saveSlackInstallWorkspace} from '#slack-callback.js';

export function SlackInstallPage() {
  const createInstall = useCreateSlackInstallMutation();
  const installRequest = useCallback(
    async (body: {workspace_id: string}) => await createInstall.mutateAsync(body),
    [createInstall],
  );
  return (
    <RedirectInstallPage
      installRequest={installRequest}
      errorFallbackMessage="Could not start Slack install."
      loadingLabel="Connecting Slack"
      beforeRedirect={(workspaceId) =>
        saveSlackInstallWorkspace(sessionStorageOrUndefined(), workspaceId)
      }
    />
  );
}
