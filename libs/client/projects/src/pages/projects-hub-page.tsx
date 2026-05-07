import type {ProjectResponseDto} from '@shipfox/api-projects-dto';
import {useActiveWorkspace} from '@shipfox/client-auth';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Code,
  Header,
  Icon,
  Input,
  Skeleton,
  StatusBadge,
  Text,
} from '@shipfox/react-ui';
import {Link} from '@tanstack/react-router';
import {useEffect, useState} from 'react';
import {useProjectsInfiniteQuery} from '#hooks/api/projects.js';
import {projectErrorCopy} from '#project-error.js';

export function ProjectsHubPage() {
  const workspace = useActiveWorkspace();
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebouncedValue(searchInput, 250).trim();
  const query = useProjectsInfiniteQuery(workspace.id, debouncedSearch || undefined);
  const projects = query.data?.pages.flatMap((page) => page.projects) ?? [];
  const errorCopy = query.error ? projectErrorCopy(query.error) : undefined;

  const isInitialLoading = query.isPending;
  const isSearching = Boolean(debouncedSearch && query.isFetching);
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
                  className="size-16 animate-spin text-foreground-neutral-muted"
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

      {query.isError && hasNoData ? (
        <Alert variant="error">
          <div className="flex flex-col gap-8">
            <Text size="sm" bold>
              {errorCopy?.title}
            </Text>
            <Text size="sm">{errorCopy?.message}</Text>
            <Button size="sm" variant="secondary" onClick={() => query.refetch()}>
              Retry
            </Button>
          </div>
        </Alert>
      ) : null}

      {!isInitialLoading && !query.isError && projects.length === 0 && !debouncedSearch ? (
        <EmptyProjects workspaceId={workspace.id} />
      ) : null}

      {!query.isFetching && !query.isError && projects.length === 0 && debouncedSearch ? (
        <NoSearchResults search={debouncedSearch} onClear={() => setSearchInput('')} />
      ) : null}

      {projects.length > 0 ? (
        <section aria-label="Projects list">
          <ul className="grid gap-16 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <ProjectCard project={project} key={project.id} workspaceId={workspace.id} />
            ))}
          </ul>
          {query.error && query.data ? (
            <Alert variant="warning" className="mt-16">
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
      className="grid gap-16 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
    >
      {[0, 1, 2, 3, 4, 5].map((row) => (
        <li key={row}>
          <Card className="p-20 h-full gap-12">
            <div className="flex items-center justify-between gap-12">
              <Skeleton className="h-20 w-1/2" />
              <Skeleton className="h-20 w-72 shrink-0" />
            </div>
            <Skeleton className="h-16 w-2/3" />
          </Card>
        </li>
      ))}
    </ul>
  );
}

function EmptyProjects({workspaceId}: {workspaceId: string}) {
  return (
    <Card className="items-center gap-18 p-32 text-center">
      <div className="flex size-44 items-center justify-center rounded-8 border border-border-neutral-base bg-background-neutral-base">
        <Icon name="folderLine" className="size-24 text-background-highlight-interactive" />
      </div>
      <CardHeader className="items-center">
        <CardTitle variant="h2">Create your first project</CardTitle>
        <CardDescription>
          Connect a repository-backed project to start building workflows.
        </CardDescription>
      </CardHeader>
      <Button asChild iconRight="chevronRight">
        <Link to="/workspaces/$wid/projects/new" params={{wid: workspaceId}}>
          Create project
        </Link>
      </Button>
    </Card>
  );
}

function NoSearchResults({search, onClear}: {search: string; onClear: () => void}) {
  return (
    <Card className="items-center gap-18 p-32 text-center">
      <div className="flex size-44 items-center justify-center rounded-8 border border-border-neutral-base bg-background-neutral-base">
        <Icon name="searchLine" className="size-24 text-foreground-neutral-muted" />
      </div>
      <CardHeader className="items-center">
        <CardTitle variant="h3">No projects match “{search}”</CardTitle>
        <CardDescription>Try a different search, or clear it to see all projects.</CardDescription>
      </CardHeader>
      <Button size="sm" variant="secondary" onClick={onClear}>
        Clear search
      </Button>
    </Card>
  );
}

function ProjectCard({project, workspaceId}: {project: ProjectResponseDto; workspaceId: string}) {
  return (
    <li className="contents">
      <Link
        to="/workspaces/$wid/projects/$pid"
        params={{wid: workspaceId, pid: project.id}}
        className="block h-full rounded-8 focus-visible:outline-none focus-visible:shadow-button-secondary-focus"
      >
        <Card className="p-20 h-full gap-12 hover:bg-background-components-hover transition-colors">
          <CardContent className="flex flex-col gap-8 p-0">
            <div className="flex items-center justify-between gap-12">
              <Text size="lg" bold className="truncate">
                {project.name}
              </Text>
              <StatusBadge variant="success" className="shrink-0">
                Connected
              </StatusBadge>
            </div>
            <Code variant="paragraph" className="text-foreground-neutral-muted truncate">
              {project.source.external_repository_id}
            </Code>
          </CardContent>
        </Card>
      </Link>
    </li>
  );
}
