import {ApiError} from '@shipfox/client-api';
import {useAuthState} from '@shipfox/client-auth';
import {Alert, Button, Card, Header, Icon, Skeleton, Text} from '@shipfox/react-ui';
import {Link} from '@tanstack/react-router';
import type {ReactNode} from 'react';
import {useIntegrationProvidersQuery, useSourceConnectionsQuery} from '#hooks/api/integrations.js';
import {PROVIDER_CATALOG} from '#provider-catalog.js';

function ConnectLink({provider, children}: {provider: string; children: ReactNode}) {
  if (provider === 'github') {
    return <Link to="/setup/integrations/github">{children}</Link>;
  }
  if (provider === 'debug') {
    return <Link to="/setup/integrations/debug">{children}</Link>;
  }
  return null;
}

export function IntegrationGalleryPage() {
  const auth = useAuthState();
  const workspace = auth.workspaces[0];
  const connectionsQuery = useSourceConnectionsQuery(workspace?.id);
  const hasConnection = (connectionsQuery.data?.connections ?? []).length > 0;
  const query = useIntegrationProvidersQuery({capability: 'source_control'});
  const providers = query.data?.providers ?? [];
  const renderable = providers.flatMap((provider) => {
    const catalog = PROVIDER_CATALOG[provider.provider];
    if (!catalog) return [];
    return [{provider, catalog}];
  });

  return (
    <main className="min-h-screen bg-background-subtle-base px-24 py-32 max-[520px]:px-16">
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-20">
        <header className="flex flex-col gap-8">
          {hasConnection ? (
            <Button asChild variant="transparent" className="w-fit px-0">
              <Link to="/">Back to projects</Link>
            </Button>
          ) : null}
          <div>
            <Header variant="h1">Connect source control</Header>
            <Text size="md" className="text-foreground-neutral-muted">
              Shipfox needs a source control integration to import your repositories.
            </Text>
          </div>
        </header>

        {query.isPending ? <GallerySkeleton /> : null}

        {query.isError ? (
          <Alert variant="error">
            <div className="flex flex-col gap-8">
              <Text size="sm" bold>
                Could not load providers
              </Text>
              <Text size="sm">
                {query.error instanceof ApiError ? query.error.message : 'Please try again.'}
              </Text>
              <Button size="sm" variant="secondary" onClick={() => query.refetch()}>
                Retry
              </Button>
            </div>
          </Alert>
        ) : null}

        {!query.isPending && !query.isError && renderable.length === 0 ? (
          <Card className="items-start gap-8 p-16">
            <Text size="sm" bold>
              No source-control providers configured
            </Text>
            <Text size="sm" className="text-foreground-neutral-muted">
              Enable at least one source-control provider in the application settings.
            </Text>
          </Card>
        ) : null}

        {renderable.length > 0 ? (
          <section className="flex flex-col gap-8" aria-label="Available providers">
            {renderable.map(({provider, catalog}) => (
              <Card key={provider.provider} className="p-16">
                <div className="flex items-center justify-between gap-12">
                  <div className="flex min-w-0 items-center gap-12">
                    <Icon
                      name={catalog.iconName}
                      className="size-24 shrink-0 text-foreground-neutral-base"
                    />
                    <Text size="md" bold className="truncate">
                      {provider.display_name}
                    </Text>
                  </div>
                  <Button asChild>
                    <ConnectLink provider={provider.provider}>Connect</ConnectLink>
                  </Button>
                </div>
              </Card>
            ))}
          </section>
        ) : null}
      </div>
    </main>
  );
}

function GallerySkeleton() {
  return (
    <div className="flex flex-col gap-8" role="status" aria-label="Loading providers">
      {[0, 1].map((row) => (
        <Card className="p-16" key={row}>
          <div className="flex items-center justify-between gap-12">
            <div className="flex items-center gap-12">
              <Skeleton className="size-24 shrink-0" />
              <Skeleton className="h-16 w-120" />
            </div>
            <Skeleton className="h-32 w-96" />
          </div>
        </Card>
      ))}
    </div>
  );
}
