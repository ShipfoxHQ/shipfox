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
  Header,
  Icon,
  Skeleton,
  StatusBadge,
  Text,
} from '@shipfox/react-ui';
import {Link} from '@tanstack/react-router';
import {useProjectsInfiniteQuery} from '#hooks/api/projects.js';
import {projectErrorCopy} from '#project-error.js';

export function ProjectsHubPage() {
  const workspace = useActiveWorkspace();
  const query = useProjectsInfiniteQuery(workspace.id);
  const projects = query.data?.pages.flatMap((page) => page.projects) ?? [];
  const errorCopy = query.error ? projectErrorCopy(query.error) : undefined;

  return (
    <div className="flex w-full flex-col gap-24">
      <header className="flex items-start justify-between gap-24 max-[640px]:flex-col">
        <Header variant="h2">Projects</Header>
        <Button asChild iconLeft="addLine">
          <Link to="/setup/projects/new" search={{wid: workspace.id}}>
            New project
          </Link>
        </Button>
      </header>

      {query.isPending ? <ProjectsSkeleton /> : null}

      {query.isError && !query.data ? (
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

      {!query.isPending && !query.isError && projects.length === 0 ? (
        <EmptyProjects workspaceId={workspace.id} />
      ) : null}

      {projects.length > 0 ? (
        <section className="flex flex-col gap-12" aria-label="Projects list">
          {projects.map((project) => (
            <ProjectRow project={project} key={project.id} workspaceId={workspace.id} />
          ))}
          {query.error && query.data ? (
            <Alert variant="warning">
              <Text size="sm">
                Could not load the next page. Existing projects are still shown.
              </Text>
            </Alert>
          ) : null}
          {query.hasNextPage ? (
            <Button
              variant="secondary"
              isLoading={query.isFetchingNextPage}
              onClick={() => query.fetchNextPage()}
            >
              Load more
            </Button>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function ProjectsSkeleton() {
  return (
    <div className="flex flex-col gap-12" role="status" aria-label="Loading projects">
      {[0, 1, 2].map((row) => (
        <Card className="p-18" key={row}>
          <Skeleton className="h-20 w-1/3" />
          <Skeleton className="h-16 w-2/3" />
        </Card>
      ))}
    </div>
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
        <Link to="/setup/projects/new" search={{wid: workspaceId}}>
          Create project
        </Link>
      </Button>
    </Card>
  );
}

function ProjectRow({project, workspaceId}: {project: ProjectResponseDto; workspaceId: string}) {
  return (
    <Card className="p-18">
      <Link
        to="/workspaces/$wid/projects/$pid"
        params={{wid: workspaceId, pid: project.id}}
        className="block"
      >
        <CardContent className="flex items-center justify-between gap-18 max-[640px]:flex-col max-[640px]:items-start">
          <div className="min-w-0">
            <Text size="lg" bold className="truncate">
              {project.name}
            </Text>
            <Text size="sm" className="text-foreground-neutral-muted truncate">
              {project.source.external_repository_id}
            </Text>
          </div>
          <StatusBadge variant="success">Connected</StatusBadge>
        </CardContent>
      </Link>
    </Card>
  );
}
