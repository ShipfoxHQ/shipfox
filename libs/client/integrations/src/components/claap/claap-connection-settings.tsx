import {Button} from '@shipfox/react-ui/button';
import {Callout, CalloutContent, CalloutDescription, CalloutTitle} from '@shipfox/react-ui/callout';
import {Panel, PanelBody, PanelHeader, PanelTitle} from '@shipfox/react-ui/panel';
import {Text} from '@shipfox/react-ui/typography';
import {useState} from 'react';
import type {IntegrationConnection} from '#core/models.js';
import {ClaapReplaceApiKeyModal} from './claap-replace-api-key-modal.js';

export function ClaapConnectionSettings({
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
          <PanelTitle>API key</PanelTitle>
        </PanelHeader>
        <PanelBody className="gap-group p-panel">
          {isError ? (
            <Callout role="alert" type="error">
              <CalloutContent>
                <CalloutTitle>Claap could not authenticate</CalloutTitle>
                <CalloutDescription>
                  Claap rejected this connection's API key. Replace the key to restore the
                  connection.
                </CalloutDescription>
              </CalloutContent>
            </Callout>
          ) : (
            <Text size="sm" className="text-foreground-neutral-muted">
              Replace the API key without changing this connection or its workflow slug.
            </Text>
          )}
          <div className="flex items-center gap-group">
            <Button type="button" onClick={() => setReplaceOpen(true)}>
              Replace API key
            </Button>
          </div>
        </PanelBody>
      </Panel>
      <ClaapReplaceApiKeyModal
        workspaceId={workspaceId}
        connection={connection}
        open={replaceOpen}
        onOpenChange={setReplaceOpen}
      />
    </>
  );
}
