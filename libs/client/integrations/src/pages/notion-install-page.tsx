import {sessionStorageOrUndefined} from '@shipfox/client-ui';
import {Text} from '@shipfox/react-ui/typography';
import {useCallback} from 'react';
import {RedirectInstallPage} from '#components/redirect-install-page.js';
import {useCreateNotionInstallMutation} from '#hooks/api/integrations.js';
import {saveNotionInstallWorkspace} from '#notion-callback.js';

export function NotionInstallPage() {
  const createInstall = useCreateNotionInstallMutation();
  const installRequest = useCallback(
    async (body: {workspace_id: string}) => await createInstall.mutateAsync(body),
    [createInstall],
  );

  return (
    <>
      <Text size="sm">
        Connecting a Notion workspace that is already connected replaces the pages available to
        existing workflows.
      </Text>
      <RedirectInstallPage
        installRequest={installRequest}
        errorFallbackMessage="Could not start Notion install."
        loadingLabel="Connecting Notion"
        beforeRedirect={(workspaceId) => {
          try {
            saveNotionInstallWorkspace(sessionStorageOrUndefined(), workspaceId);
          } catch {
            // Storage can be disabled before the helper gets a usable Storage object.
          }
        }}
      />
    </>
  );
}
