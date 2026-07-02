import {useActiveWorkspace} from '@shipfox/client-auth';
import {Header, Text} from '@shipfox/react-ui/typography';
import {ProviderGrid} from '#components/provider-grid.js';
import {useIntegrationProvidersQuery} from '#hooks/api/integrations.js';

export function SourceControlOnboardingPage() {
  const workspace = useActiveWorkspace();
  const providersQuery = useIntegrationProvidersQuery({capability: 'source_control'});

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-20">
      <header className="flex flex-col gap-8">
        <Header variant="h1">Install source control</Header>
        <Text size="md" className="text-foreground-neutral-muted">
          Shipfox needs a source control integration to import your repositories.
        </Text>
      </header>

      <ProviderGrid
        providersQuery={providersQuery}
        workspaceId={workspace.id}
        emptyMessage="Enable at least one source-control provider in the application settings."
      />
    </div>
  );
}
