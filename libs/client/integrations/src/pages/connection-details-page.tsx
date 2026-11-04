import {useActiveWorkspace} from '@shipfox/client-auth';
import {QueryLoadError} from '@shipfox/client-ui';
import {Button} from '@shipfox/react-ui/button';
import {Callout, CalloutContent, CalloutDescription, CalloutTitle} from '@shipfox/react-ui/callout';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {FullPageLoader} from '@shipfox/react-ui/loader';
import {Panel, PanelBody, PanelHeader, PanelTitle} from '@shipfox/react-ui/panel';
import {Header, Text} from '@shipfox/react-ui/typography';
import {Link} from '@tanstack/react-router';
import {type ReactNode, useState} from 'react';
import {ClaapConnectionSettings} from '#components/claap/claap-connection-settings.js';
import {JamConnectionSettings} from '#components/jam/jam-connection-settings.js';
import {PosthogReplaceApiKeyModal} from '#components/posthog/posthog-replace-api-key-modal.js';
import type {IntegrationConnection} from '#core/models.js';
import {useIntegrationConnectionsQuery} from '#hooks/api/integrations.js';
import {hasCredentialSettings, PROVIDER_CATALOG} from '#provider-catalog.js';

export function ConnectionDetailsPage({
  workspaceSlug,
  connectionSlug,
}: {
  workspaceSlug: string;
  connectionSlug: string;
}) {
  const workspace = useActiveWorkspace();
  const connectionsQuery = useIntegrationConnectionsQuery(workspace.id);

  if (connectionsQuery.isPending) return <FullPageLoader aria-label="Loading connection details" />;

  if (connectionsQuery.isError && connectionsQuery.data === undefined) {
    return (
      <ConnectionDetailsShell workspaceSlug={workspaceSlug}>
        <QueryLoadError query={connectionsQuery} subject="integrations" />
      </ConnectionDetailsShell>
    );
  }

  const connection = connectionsQuery.data?.find(({slug}) => slug === connectionSlug);
  if (!connection) {
    return (
      <ConnectionDetailsShell workspaceSlug={workspaceSlug}>
        <EmptyState
          icon="errorWarningLine"
          tone="error"
          title="Integration connection not found"
          description="This integration does not exist, or you don't have access to it."
        />
      </ConnectionDetailsShell>
    );
  }

  return (
    <ConnectionDetailsShell
      workspaceSlug={workspaceSlug}
      connectionName={connection.displayName}
      title={connectionDetailsTitle(connection)}
    >
      {connection.reconnectRequired ? (
        <ReconnectNotice connection={connection} workspaceSlug={workspaceSlug} />
      ) : null}
      <ConnectionSettings connection={connection} />
    </ConnectionDetailsShell>
  );
}

function ConnectionSettings({connection}: {connection: IntegrationConnection}) {
  if (connection.provider === 'posthog')
    return (
      <PosthogConnectionSettings connection={connection} workspaceId={connection.workspaceId} />
    );
  if (connection.provider === 'jam')
    return <JamConnectionSettings connection={connection} workspaceId={connection.workspaceId} />;
  if (connection.provider === 'claap')
    return <ClaapConnectionSettings connection={connection} workspaceId={connection.workspaceId} />;
  const accessNotice = connection.capabilities.includes('source_control')
    ? PROVIDER_ACCESS_NOTICES[connection.provider]
    : undefined;
  if (accessNotice) return <ProviderAccessNotice connection={connection} copy={accessNotice} />;
  // The reconnect notice is this connection's only action.
  if (connection.reconnectRequired) return null;
  return (
    <EmptyState
      icon="settings3Line"
      tone="neutral"
      title="No settings to change"
      description="This integration connection has no settings on this page."
    />
  );
}

function ReconnectNotice({
  connection,
  workspaceSlug,
}: {
  connection: IntegrationConnection;
  workspaceSlug: string;
}) {
  const catalog = PROVIDER_CATALOG[connection.provider];
  const providerName = catalog?.displayName ?? 'this integration';
  return (
    <Callout role="alert" type="warning">
      <CalloutContent>
        <CalloutTitle>New permissions needed</CalloutTitle>
        <CalloutDescription>
          Until you reconnect, agents don&apos;t answer here. Workflows keep running.
        </CalloutDescription>
        {catalog?.kind === 'redirect-install' ? (
          <Button asChild size="sm" className="w-fit">
            <Link to={catalog.setupPath} params={{workspaceSlug}}>
              Reconnect {providerName}
            </Link>
          </Button>
        ) : null}
      </CalloutContent>
    </Callout>
  );
}

function connectionDetailsTitle(connection: IntegrationConnection): string {
  if (hasCredentialSettings(connection.provider))
    return `${PROVIDER_CATALOG[connection.provider]?.displayName} connection`;
  return 'Integration connection';
}

function ConnectionDetailsShell({
  workspaceSlug,
  connectionName,
  title = 'Integration connection',
  children,
}: {
  workspaceSlug: string;
  connectionName?: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-section">
      <Link
        to="/w/$workspaceSlug/settings/integrations"
        params={{workspaceSlug}}
        className="self-start text-sm text-foreground-neutral-muted hover:text-foreground-neutral-base"
      >
        Back to integrations
      </Link>
      <div className="flex min-w-0 flex-col gap-tight">
        <Header variant="h1">{title}</Header>
        {connectionName ? (
          <Text size="sm" className="text-foreground-neutral-muted">
            {connectionName}
          </Text>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function PosthogConnectionSettings({
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
                <CalloutTitle>PostHog could not authenticate</CalloutTitle>
                <CalloutDescription>
                  This connection is not available because its API key was rejected. Replace the key
                  to restore the connection.
                </CalloutDescription>
              </CalloutContent>
            </Callout>
          ) : (
            <Text size="sm" className="text-foreground-neutral-muted">
              Replace the personal API key without changing this connection or its workflow slug.
            </Text>
          )}
          <div className="flex items-center gap-group">
            <Button type="button" onClick={() => setReplaceOpen(true)}>
              Replace API key
            </Button>
          </div>
        </PanelBody>
      </Panel>
      <PosthogReplaceApiKeyModal
        workspaceId={workspaceId}
        connection={connection}
        open={replaceOpen}
        onOpenChange={setReplaceOpen}
      />
    </>
  );
}

interface ProviderAccessNoticeCopy {
  title: string;
  description: string;
  linkLabel: string;
  fallbackUrl: string;
}

// Where the outer repository list is managed is provider-specific. Providers without an entry
// get no notice; the panel copy above stays provider-neutral.
const PROVIDER_ACCESS_NOTICES: Record<string, ProviderAccessNoticeCopy> = {
  github: {
    title: 'Repository access is set on GitHub',
    description: 'To add or remove repositories the GitHub App can access, change it on GitHub.',
    linkLabel: 'Change repositories on GitHub',
    fallbackUrl: 'https://github.com/settings/installations',
  },
};

function ProviderAccessNotice({
  connection,
  copy,
}: {
  connection: IntegrationConnection;
  copy: ProviderAccessNoticeCopy;
}) {
  return (
    <Callout type="info">
      <CalloutContent>
        <CalloutTitle>{copy.title}</CalloutTitle>
        <CalloutDescription>
          {copy.description}{' '}
          <a
            href={connection.externalUrl ?? copy.fallbackUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            {copy.linkLabel}
          </a>
        </CalloutDescription>
      </CalloutContent>
    </Callout>
  );
}
