import type {IntegrationConnectionDto} from '@shipfox/api-integration-core-dto';
import {createProjectBodySchema} from '@shipfox/api-projects-dto';
import {useAuthState} from '@shipfox/client-auth';
import {
  ConnectionPicker,
  RepositoryPicker,
  useRepositoriesInfiniteQuery,
  useSourceConnectionsQuery,
} from '@shipfox/client-integrations';
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FullPageLoader,
  Header,
  Label,
  Text,
  toast,
} from '@shipfox/react-ui';
import {useQueryClient} from '@tanstack/react-query';
import {Link, Navigate, useNavigate} from '@tanstack/react-router';
import {type FormEvent, useEffect, useRef, useState} from 'react';
import {
  projectsQueryKeys,
  useCreateProjectMutation,
  useProjectsInfiniteQuery,
} from '#hooks/api/projects.js';
import {projectErrorCopy} from '#project-error.js';

const REPOSITORY_NAME_SPLIT_RE = /[/-]/;

export function CreateProjectPage() {
  const auth = useAuthState();
  const workspace = auth.workspaces[0];
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const createProject = useCreateProjectMutation();
  const errorRef = useRef<HTMLDivElement>(null);

  const connectionsQuery = useSourceConnectionsQuery(workspace?.id);
  const connections = connectionsQuery.data?.connections ?? [];

  const projectsQuery = useProjectsInfiniteQuery(workspace?.id);
  const hasProjects = (projectsQuery.data?.pages.flatMap((page) => page.projects) ?? []).length > 0;

  const [selectedConnectionId, setSelectedConnectionId] = useState<string | undefined>();
  useEffect(() => {
    if (connections.length === 1 && !selectedConnectionId) {
      setSelectedConnectionId(connections[0]?.id);
    }
  }, [connections, selectedConnectionId]);

  const selectedConnection: IntegrationConnectionDto | undefined = connections.find(
    (connection) => connection.id === selectedConnectionId,
  );

  const repositoriesQuery = useRepositoriesInfiniteQuery(selectedConnectionId);
  const repositories = repositoriesQuery.data?.pages.flatMap((page) => page.repositories) ?? [];

  const [selectedRepositoryId, setSelectedRepositoryId] = useState<string | undefined>();
  useEffect(() => {
    if (!selectedRepositoryId && repositories[0]) {
      setSelectedRepositoryId(repositories[0].external_repository_id);
    }
  }, [repositories, selectedRepositoryId]);
  const selectedRepository = repositories.find(
    (repository) => repository.external_repository_id === selectedRepositoryId,
  );

  const [nameTouched, setNameTouched] = useState(false);
  const [name, setName] = useState('');
  const defaultProjectName = projectNameFromRepository(
    selectedRepository?.name ?? selectedRepositoryId ?? '',
  );
  const projectName = nameTouched ? name : defaultProjectName;

  const [formError, setFormError] = useState<string | undefined>();

  function selectConnection(connectionId: string) {
    setSelectedConnectionId(connectionId);
    setSelectedRepositoryId(undefined);
  }

  if (connectionsQuery.isPending) {
    return <FullPageLoader />;
  }

  if (!connectionsQuery.isError && connections.length === 0) {
    return <Navigate to="/setup/integrations" replace />;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(undefined);
    if (!workspace) {
      setFormError('Workspace is still loading. Try again in a moment.');
      errorRef.current?.focus();
      return;
    }
    if (!selectedConnection) {
      setFormError('Choose a source-control connection before creating a project.');
      errorRef.current?.focus();
      return;
    }
    if (!selectedRepository) {
      setFormError('Choose a repository before creating a project.');
      errorRef.current?.focus();
      return;
    }
    if (!projectName.trim()) {
      setFormError('Project name is required.');
      errorRef.current?.focus();
      return;
    }

    try {
      const projectBody = createProjectBodySchema.parse({
        workspace_id: workspace.id,
        name: projectName.trim(),
        source: {
          connection_id: selectedConnection.id,
          external_repository_id: selectedRepository.external_repository_id,
        },
      });
      const project = await createProject.mutateAsync(projectBody);
      await queryClient.invalidateQueries({queryKey: projectsQueryKeys.list(workspace.id)});
      queryClient.setQueryData(projectsQueryKeys.detail(project.id), project);
      toast.success('Project created.');
      await navigate({to: '/projects/$projectId', params: {projectId: project.id}});
    } catch (error) {
      const copy = projectErrorCopy(error);
      if (copy.existingProjectId) {
        toast.info('Project already exists.');
        await navigate({to: '/projects/$projectId', params: {projectId: copy.existingProjectId}});
        return;
      }
      setFormError(`${copy.title}: ${copy.message}`);
      requestAnimationFrame(() => errorRef.current?.focus());
    }
  }

  const showRepoPicker = Boolean(selectedConnection);

  return (
    <main className="min-h-screen bg-background-subtle-base px-24 py-32 max-[520px]:px-16">
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-24">
        <header className="flex flex-col gap-8">
          {hasProjects ? (
            <ButtonLink variant="muted" href="/">
              Back to projects
            </ButtonLink>
          ) : null}
          <div>
            <Header variant="h1">Create project</Header>
            <Text size="md" className="text-foreground-neutral-muted">
              Choose a repository to create a project from.
            </Text>
          </div>
        </header>

        {connectionsQuery.isError ? (
          <Alert variant="error">
            <Text size="sm">Could not load source-control connections. Try again.</Text>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => connectionsQuery.refetch()}
              className="mt-8 w-fit"
            >
              Retry
            </Button>
          </Alert>
        ) : null}

        <form onSubmit={onSubmit} noValidate aria-labelledby="create-project-title">
          <Card className="gap-20 p-24">
            <CardHeader>
              <CardTitle id="create-project-title" variant="h2">
                Project source
              </CardTitle>
              <CardDescription>
                Pick a repository visible to one of your source-control connections.
              </CardDescription>
            </CardHeader>

            {formError ? (
              <Alert variant="error" animated={false}>
                <div ref={errorRef} tabIndex={-1}>
                  {formError}
                </div>
              </Alert>
            ) : null}

            <CardContent className="flex flex-col gap-18">
              {connections.length === 1 && selectedConnection ? (
                <SingleConnectionSummary connection={selectedConnection} />
              ) : null}

              {connections.length > 1 ? (
                <ConnectionPicker
                  connections={connections}
                  selectedConnectionId={selectedConnectionId}
                  onSelect={selectConnection}
                />
              ) : null}

              {showRepoPicker ? (
                <RepositoryPicker
                  repositories={repositories}
                  selectedRepositoryId={selectedRepositoryId}
                  onSelect={setSelectedRepositoryId}
                  isLoading={repositoriesQuery.isPending}
                  isFetchingNextPage={repositoriesQuery.isFetchingNextPage}
                  hasNextPage={repositoriesQuery.hasNextPage}
                  onLoadMore={() => repositoriesQuery.fetchNextPage()}
                  emptyMessage="No repositories visible to this connection."
                />
              ) : null}

              <div className="flex flex-col gap-8">
                <Label htmlFor="project-name">Project name</Label>
                <input
                  id="project-name"
                  className="h-32 rounded-6 border border-border-neutral-base bg-background-neutral-base px-12 text-md"
                  value={projectName}
                  onChange={(event) => {
                    setNameTouched(true);
                    setName(event.target.value);
                  }}
                  placeholder="Platform"
                />
              </div>
            </CardContent>

            <Button
              type="submit"
              iconRight="chevronRight"
              isLoading={createProject.isPending}
              disabled={!selectedConnection || !selectedRepository}
            >
              Create project
            </Button>
          </Card>
        </form>
      </div>
    </main>
  );
}

function SingleConnectionSummary({connection}: {connection: IntegrationConnectionDto}) {
  return (
    <div className="flex flex-col gap-8">
      <Label>Source connection</Label>
      <div className="rounded-8 border border-border-neutral-base bg-background-neutral-base p-14">
        <Text size="sm" bold>
          {connection.display_name}
        </Text>
        <Text size="xs" className="text-foreground-neutral-muted">
          {connection.provider} · {connection.external_account_id}
        </Text>
      </div>
      <Button asChild variant="transparent" size="sm" className="w-fit px-0">
        <Link to="/setup/integrations">Add another integration</Link>
      </Button>
    </div>
  );
}

function projectNameFromRepository(repositoryId: string): string {
  return repositoryId
    .trim()
    .split(REPOSITORY_NAME_SPLIT_RE)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
