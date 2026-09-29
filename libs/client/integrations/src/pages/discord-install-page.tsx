import {sessionStorageOrUndefined} from '@shipfox/client-ui';
import {Text} from '@shipfox/react-ui/typography';
import {useCallback} from 'react';
import {RedirectInstallPage} from '#components/redirect-install-page.js';
import {saveDiscordInstallWorkspace} from '#discord-callback.js';
import {useCreateDiscordInstallMutation} from '#hooks/api/integrations.js';

export function DiscordInstallPage() {
  const createInstall = useCreateDiscordInstallMutation();
  const installRequest = useCallback(
    async (body: {workspace_id: string}) => await createInstall.mutateAsync(body),
    [createInstall],
  );

  return (
    <>
      <Text size="sm">
        Connecting a Discord server that is already connected links it to this workspace again.
      </Text>
      <RedirectInstallPage
        installRequest={installRequest}
        errorFallbackMessage="Could not start Discord install."
        loadingLabel="Connecting Discord"
        beforeRedirect={(workspaceId) => {
          try {
            saveDiscordInstallWorkspace(sessionStorageOrUndefined(), workspaceId);
          } catch {
            // Storage can be disabled before the helper gets a usable Storage object.
          }
        }}
      />
    </>
  );
}
