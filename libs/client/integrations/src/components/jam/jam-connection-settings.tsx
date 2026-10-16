import {QueryLoadError} from '@shipfox/client-ui';
import {Button} from '@shipfox/react-ui/button';
import {Callout, CalloutContent, CalloutDescription, CalloutTitle} from '@shipfox/react-ui/callout';
import {Panel, PanelBody, PanelHeader, PanelTitle} from '@shipfox/react-ui/panel';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {Text} from '@shipfox/react-ui/typography';
import {useState} from 'react';
import type {IntegrationConnection} from '#core/models.js';
import {useJamConnectionDetailsQuery} from '#hooks/api/integrations.js';
import {JamReplaceTokenModal} from './jam-replace-token-modal.js';

export function JamConnectionSettings({
  connection,
  workspaceId,
}: {
  connection: IntegrationConnection;
  workspaceId: string;
}) {
  const [replaceOpen, setReplaceOpen] = useState(false);
  const isError = connection.lifecycleStatus === 'error';

  return (
    <>
      <Panel>
        <PanelHeader>
          <PanelTitle>Personal access token</PanelTitle>
        </PanelHeader>
        <PanelBody className="gap-group p-panel">
          {isError ? (
            <Callout role="alert" type="error">
              <CalloutContent>
                <CalloutTitle>Jam rejected the token</CalloutTitle>
                <CalloutDescription>
                  The token has probably expired or been revoked. Replace it with a new token to
                  restore the connection.
                </CalloutDescription>
              </CalloutContent>
            </Callout>
          ) : null}
          <JamConnectionIdentity connectionId={connection.id} />
          <div className="flex items-center gap-group">
            <Button type="button" onClick={() => setReplaceOpen(true)}>
              Replace token
            </Button>
          </div>
        </PanelBody>
      </Panel>
      <JamReplaceTokenModal
        workspaceId={workspaceId}
        connection={connection}
        open={replaceOpen}
        onOpenChange={setReplaceOpen}
      />
    </>
  );
}

function JamConnectionIdentity({connectionId}: {connectionId: string}) {
  const detailsQuery = useJamConnectionDetailsQuery(connectionId);

  if (detailsQuery.isPending) {
    return (
      <>
        <div role="status" className="sr-only">
          Loading Jam connection details.
        </div>
        <Skeleton className="h-40 w-full" />
      </>
    );
  }

  if (detailsQuery.isError) {
    return <QueryLoadError query={detailsQuery} subject="Jam connection details" variant="panel" />;
  }

  const {userName, userEmail, tokenHint} = detailsQuery.data;
  return (
    <div className="flex min-w-0 flex-col gap-tight">
      <Text size="sm">
        Tools see the Jams that <strong>{userName}</strong>
        {userEmail ? ` (${userEmail})` : null} can see in Jam.
      </Text>
      <Text size="sm" className="text-foreground-neutral-muted">
        Token ending in {tokenHint}.
      </Text>
    </div>
  );
}
