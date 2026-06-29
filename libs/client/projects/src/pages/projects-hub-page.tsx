import type {IntegrationConnectionDto} from '@shipfox/api-integration-core-dto';
import type {ProjectResponseDto} from '@shipfox/api-projects-dto';
import {useActiveWorkspace} from '@shipfox/client-auth';
import {
  ConnectionStatusBadge,
  IntegrationIcon,
  useIntegrationConnectionsQuery,
} from '@shipfox/client-integrations';
import {QueryLoadError} from '@shipfox/client-ui';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Header,
  Icon,
  Input,
  Skeleton,
  Text,
} from '@shipfox/react-ui';
import {Link} from '@tanstack/react-router';
import {useEffect, useState} from 'react';
import {useProjectsInfiniteQuery} from '#hooks/api/projects.js';

export function ProjectsHubPage() {
  const workspace = useActiveWorkspace();
  const [searchInput, setSearchInput] = useState('');
  const trimmedInput = searchInput.trim();
  const debouncedSearch = useDebouncedValue(trimmedInput, 250);
  const query = useProjectsInfiniteQuery(workspace.id, debouncedSearch || undefined);
  const projects = query.data?.pages.flatMap((page) => page.projects) ?? [];

  // The provider logo and connection health live on the integration connection,
  // not the project, so resolve them once for the whole list and index by id.
  // Skip the fetch when there are no cards to annotate.
  const connectionsQuery = useIntegrationConnectionsQuery(
    projects.length > 0 ? workspace.id : undefined,
  );
  const connectionsById = new Map(
    (connectionsQuery.data?.connections ?? []).map((connection) => [connection.id, connection]),
  );

  const isInitialLoading = query.isPending;
  const isDebouncePending = trimmedInput !== debouncedSearch;
  const isSearching =
    Boolean(trimmedInput) && (isDebouncePending || (query.isFetching && !query.isFetchingNextPage));
  const hasNoData = !query.data;

  return (
    <div className="flex w-full flex-col gap-24">
      <header className="flex flex-col gap-16">
        <div className="flex items-start justify-between gap-24 max-[640px]:flex-col">
          <Header variant="h2">Projects</Header>
        </div>
        <div className="flex items-center gap-12 max-[640px]:flex-col max-[640px]:items-stretch">
          <Input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search projects…"
            aria-label="Search projects"
            className="flex-1"
            iconLeft={<Icon name="searchLine" className="size-16" />}
            iconRight={
              isSearching ? (
                <Icon
                  name="spinner"
                  size={16}
                  className="text-foreground-neutral-muted"
                  aria-hidden="true"
                />
              ) : undefined
            }
          />
          <Button asChild iconLeft="addLine" className="shrink-0 max-[640px]:w-full">
            <Link to="/workspaces/$wid/projects/new" params={{wid: workspace.id}}>
              New project
            </Link>
          </Button>
        </div>
      </header>

      {isInitialLoading || (debouncedSearch && hasNoData && query.isFetching) ? (
        <ProjectsSkeleton />
      ) : null}

      {query.isError && hasNoData ? <QueryLoadError query={query} subject="projects" /> : null}

      {!isInitialLoading && !query.isError && projects.length === 0 && !debouncedSearch ? (
        <EmptyProjects workspaceId={workspace.id} />
      ) : null}

      {!query.isFetching && !query.isError && projects.length === 0 && debouncedSearch ? (
        <NoSearchResults search={debouncedSearch} onClear={() => setSearchInput('')} />
      ) : null}

      {projects.length > 0 ? (
        <section aria-label="Projects list">
          <ul className="grid grid-cols-2 gap-12 max-[760px]:grid-cols-1">
            {projects.map((project) => (
              <ProjectCard
                project={project}
                connection={connectionsById.get(project.source.connection_id)}
                connectionsResolved={connectionsQuery.isSuccess}
                connectionsSettled={connectionsQuery.isSuccess || connectionsQuery.isError}
                key={project.id}
                workspaceId={workspace.id}
              />
            ))}
          </ul>
          {query.error && query.data ? (
            <Alert variant="error" className="mt-16">
              <Text size="sm">
                Could not load the next page. Existing projects are still shown.
              </Text>
            </Alert>
          ) : null}
          {query.hasNextPage ? (
            <div className="mt-16 flex justify-center">
              <Button
                variant="secondary"
                isLoading={query.isFetchingNextPage}
                onClick={() => query.fetchNextPage()}
              >
                Load more
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}

function ProjectsSkeleton() {
  return (
    <ul
      role="status"
      aria-label="Loading projects"
      className="grid grid-cols-2 gap-12 max-[760px]:grid-cols-1"
    >
      {[0, 1, 2, 3, 4, 5].map((row) => (
        <li key={row}>
          <Card className="h-full p-16">
            <div className="flex items-center gap-12">
              <Skeleton className="size-24 shrink-0" />
              <Skeleton className="h-16 w-1/2" />
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}

function EmptyProjects({workspaceId}: {workspaceId: string}) {
  return (
    <EmptyState
      icon="folderLine"
      title="Create your first project"
      description="Connect a repository-backed project to start building workflows."
      action={
        <Button asChild iconRight="chevronRight">
          <Link to="/workspaces/$wid/projects/new" params={{wid: workspaceId}}>
            Create project
          </Link>
        </Button>
      }
    />
  );
}

function NoSearchResults({search, onClear}: {search: string; onClear: () => void}) {
  return (
    <EmptyState
      icon="searchLine"
      title={`No projects match “${search}”`}
      description="Try a different search, or clear it to see all projects."
      action={
        <Button size="sm" variant="secondary" onClick={onClear}>
          Clear search
        </Button>
      }
    />
  );
}

function ProjectCard({
  project,
  connection,
  connectionsResolved,
  connectionsSettled,
  workspaceId,
}: {
  project: ProjectResponseDto;
  connection: IntegrationConnectionDto | undefined;
  connectionsResolved: boolean;
  connectionsSettled: boolean;
  workspaceId: string;
}) {
  // On a resolved fetch, `active` carries no badge while a missing connection
  // reads as an error so a broken source is still flagged. An unresolved or
  // failed fetch shows nothing, so a fetch failure never flags every card.
  const status = connectionsResolved ? (connection?.lifecycle_status ?? 'error') : undefined;

  return (
    <li>
      <Link
        to="/workspaces/$wid/projects/$pid"
        params={{wid: workspaceId, pid: project.id}}
        className="block h-full rounded-8 focus-visible:shadow-button-neutral-focus focus-visible:outline-none"
      >
        <Card className="h-full p-16 transition-colors hover:bg-background-components-hover">
          <div className="flex min-w-0 items-center gap-12">
            {/* Settle on success or error: a failed fetch falls back to the
                neutral provider icon rather than spinning forever. */}
            {connectionsSettled ? (
              <IntegrationIcon
                source={connection?.provider}
                aria-hidden
                className="size-24 shrink-0 text-foreground-neutral-base"
              />
            ) : (
              <Skeleton className="size-24 shrink-0" />
            )}
            <div className="flex min-w-0 flex-1 items-center gap-8">
              <Text size="md" bold className="truncate">
                {project.name}
              </Text>
              {status ? <ConnectionStatusBadge status={status} className="shrink-0" /> : null}
            </div>
          </div>
        </Card>
      </Link>
    </li>
  );
}
