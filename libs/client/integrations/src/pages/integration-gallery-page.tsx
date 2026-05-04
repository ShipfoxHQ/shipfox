import {ApiError} from '@shipfox/client-api';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Header,
  Skeleton,
  Text,
} from '@shipfox/react-ui';
import {Link} from '@tanstack/react-router';
import {useIntegrationProvidersQuery} from '#hooks/api/integrations.js';
import {PROVIDER_CATALOG} from '#provider-catalog.js';

type SetupLinkProps = {to: '/setup/integrations/github'} | {to: '/setup/integrations/debug'};

function setupLinkFor(provider: string): SetupLinkProps | undefined {
  if (provider === 'github') return {to: '/setup/integrations/github'};
  if (provider === 'debug') return {to: '/setup/integrations/debug'};
  return undefined;
}

export function IntegrationGalleryPage() {
  const query = useIntegrationProvidersQuery({capability: 'source_control'});
  const providers = query.data?.providers ?? [];
  const renderable = providers.flatMap((provider) => {
    const catalog = PROVIDER_CATALOG[provider.provider];
    const link = setupLinkFor(provider.provider);
    if (!catalog || !link) return [];
    return [{provider, catalog, link}];
  });

  return (
    <main className="min-h-screen bg-background-subtle-base px-24 py-32 max-[520px]:px-16">
      <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-24">
        <header className="flex flex-col gap-8">
          <Button asChild variant="transparent" className="w-fit px-0">
            <Link to="/">Back to projects</Link>
          </Button>
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
          <Card className="items-start gap-12 p-24">
            <CardHeader>
              <CardTitle variant="h3">No source-control providers configured</CardTitle>
              <CardDescription>
                Enable at least one source-control provider in the application settings.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : null}

        {renderable.length > 0 ? (
          <section className="flex flex-col gap-12" aria-label="Available providers">
            {renderable.map(({provider, catalog, link}) => (
              <Card key={provider.provider} className="p-24">
                <CardContent className="flex items-center justify-between gap-18 max-[640px]:flex-col max-[640px]:items-start">
                  <div className="min-w-0">
                    <Text size="lg" bold>
                      {provider.display_name}
                    </Text>
                    <Text size="sm" className="text-foreground-neutral-muted">
                      {catalog.description}
                    </Text>
                  </div>
                  <Button asChild>
                    <Link {...link}>Connect {provider.display_name}</Link>
                  </Button>
                </CardContent>
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
    <div className="flex flex-col gap-12" role="status" aria-label="Loading providers">
      {[0, 1].map((row) => (
        <Card className="p-24" key={row}>
          <Skeleton className="h-20 w-1/3" />
          <Skeleton className="h-16 w-2/3" />
        </Card>
      ))}
    </div>
  );
}
