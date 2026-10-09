import {
  type IntegrationConnection,
  type IntegrationProvider,
  PROVIDER_CATALOG,
  ProviderGrid,
} from '@shipfox/client-integrations';
import {Button, ButtonLink, IconButton} from '@shipfox/react-ui/button';
import {Panel, PanelActions, PanelHeader, PanelTitle} from '@shipfox/react-ui/panel';
import {Text} from '@shipfox/react-ui/typography';
import {Link} from '@tanstack/react-router';
import {useId} from 'react';

export interface ToolsStepPanelProps {
  workspaceSlug: string;
  providers: readonly IntegrationProvider[];
  connections: readonly IntegrationConnection[];
  /** Connected tool providers of the workspace, whether or not the grid lists them. */
  connectedCount: number;
  onFinish: () => void;
  onDismiss: () => void;
}

/**
 * The tools step of the home. The grid lists the tool providers that install
 * through a redirect; the ones that connect in a dialog stay in settings.
 */
export function ToolsStepPanel({
  workspaceSlug,
  providers,
  connections,
  connectedCount,
  onFinish,
  onDismiss,
}: ToolsStepPanelProps) {
  const titleId = useId();
  const toolProviders = providers.filter(
    (provider) =>
      !provider.capabilities.includes('source_control') &&
      PROVIDER_CATALOG[provider.provider]?.kind === 'redirect-install',
  );

  return (
    <Panel asChild className="w-full">
      <section aria-labelledby={titleId}>
        <PanelHeader className="items-start">
          <div className="flex min-w-0 flex-col gap-tight">
            <PanelTitle id={titleId} variant="h2">
              Connect your tools
            </PanelTitle>
            <Text size="sm" className="text-foreground-neutral-muted">
              Workflows can read and act on the tools you connect. Connect them now to get better
              workflow suggestions.
            </Text>
          </div>
          <PanelActions>
            <IconButton
              type="button"
              variant="transparent"
              size="sm"
              muted
              icon="close"
              aria-label="Hide setup guide"
              onClick={onDismiss}
            />
          </PanelActions>
        </PanelHeader>
        <ProviderGrid
          embedded
          workspaceSlug={workspaceSlug}
          providers={[...toolProviders]}
          isPending={false}
          emptyMessage="Connect a tool from the integrations settings."
          connections={connections}
          showConnectionState
          returnTo="home"
        />
        <div className="flex items-center justify-between gap-group border-t border-border-neutral-base px-row py-row">
          <ButtonLink asChild variant="muted" underline>
            <Link to="/w/$workspaceSlug/settings/integrations" params={{workspaceSlug}}>
              Manage in settings
            </Link>
          </ButtonLink>
          <Button
            type="button"
            size="sm"
            variant={connectedCount > 0 ? 'primary' : 'secondary'}
            onClick={onFinish}
          >
            {connectedCount > 0 ? 'Continue' : 'Skip for now'}
          </Button>
        </div>
      </section>
    </Panel>
  );
}
