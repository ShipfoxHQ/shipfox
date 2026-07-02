import type {IntegrationConnectionDto} from '@shipfox/api-integration-core-dto';
import {
  createProjectBodySchema,
  type ListProjectsResponseDto,
  type ProjectResponseDto,
} from '@shipfox/api-projects-dto';
import {useMaybeActiveWorkspace} from '@shipfox/client-auth';
import {
  ConnectionPicker,
  IntegrationIcon,
  RepositoryPicker,
  useRepositoriesInfiniteQuery,
  useSourceConnectionsQuery,
} from '@shipfox/client-integrations';
import {displayNameFieldError} from '@shipfox/client-ui';
import {Alert} from '@shipfox/react-ui/alert';
import {Button} from '@shipfox/react-ui/button';
import {FormField, FormFieldInput, fieldError} from '@shipfox/react-ui/form-field';
import {FullPageLoader} from '@shipfox/react-ui/loader';
import {toast} from '@shipfox/react-ui/toast';
import {Header, Text} from '@shipfox/react-ui/typography';
import {useForm} from '@tanstack/react-form';
import {type QueryClient, useQueryClient} from '@tanstack/react-query';
import {Link, Navigate, useNavigate} from '@tanstack/react-router';
import {useEffect, useRef, useState} from 'react';
import {ModelProviderReminderBanner} from '#components/model-provider-reminder-banner.js';
import {projectsQueryKeys, useCreateProjectMutation} from '#hooks/api/projects.js';
import {projectErrorCopy} from '#project-error.js';

const REPOSITORY_NAME_SPLIT_RE = /[/-]/;

export function CreateProjectPage() {
  const workspace = useMaybeActiveWorkspace();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const createProject = useCreateProjectMutation();
  const errorRef = useRef<HTMLDivElement>(null);

  const connectionsQuery = useSourceConnectionsQuery(workspace?.id);
  const connections = connectionsQuery.data?.connections ?? [];

  const [selectedConnectionId, setSelectedConnectionId] = useState<string | undefined>();
  const singleConnectionId = connections.length === 1 ? connections[0]?.id : undefined;
  const effectiveSelectedConnectionId = selectedConnectionId ?? singleConnectionId;
  useEffect(() => {
    if (singleConnectionId && selectedConnectionId !== singleConnectionId) {
      setSelectedConnectionId(singleConnectionId);
    }
  }, [singleConnectionId, selectedConnectionId]);

  const selectedConnection: IntegrationConnectionDto | undefined = connections.find(
    (connection) => connection.id === effectiveSelectedConnectionId,
  );

  const [repoFilter, setRepoFilter] = useState('');
  const debouncedRepoFilter = useDebouncedValue(repoFilter, 250);
  const trimmedFilter = debouncedRepoFilter.trim();

  const repositoriesQuery = useRepositoriesInfiniteQuery(
    effectiveSelectedConnectionId,
    trimmedFilter ? {search: trimmedFilter} : undefined,
  );
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
  const defaultProjectName = projectNameFromRepository(
    selectedRepository?.name ?? selectedRepositoryId ?? '',
  );

  const [formError, setFormError] = useState<string | undefined>();

  const form = useForm({
    defaultValues: {name: defaultProjectName},
    onSubmit: async ({value}) => {
      await createProjectFromForm(nameTouched ? value.name : defaultProjectName);
    },
  });

  useEffect(() => {
    if (!nameTouched && form.state.values.name !== defaultProjectName) {
      form.setFieldValue('name', defaultProjectName);
    }
  }, [defaultProjectName, form, nameTouched]);

  function selectConnection(connectionId: string) {
    setSelectedConnectionId(connectionId);
    setSelectedRepositoryId(undefined);
  }

  if (connectionsQuery.isPending) {
    return <FullPageLoader />;
  }

  if (!workspace) {
    return <FullPageLoader />;
  }

  if (!connectionsQuery.isError && connections.length === 0) {
    return <Navigate to="/workspaces/$wid/integrations" params={{wid: workspace.id}} replace />;
  }

  async function createProjectFromForm(projectName: string) {
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

    try {
      const projectBody = createProjectBodySchema.parse({
        workspace_id: workspace.id,
        name: projectName,
        source: {
          connection_id: selectedConnection.id,
          external_repository_id: selectedRepository.external_repository_id,
        },
      });
      const project = await createProject.mutateAsync(projectBody);
      setWorkspaceProjectExists(queryClient, workspace.id, project);
      queryClient.setQueryData(projectsQueryKeys.detail(project.id), project);
      await queryClient.invalidateQueries({queryKey: projectsQueryKeys.list(workspace.id)});
      toast.success('Project created.');
      await navigate({
        to: '/workspaces/$wid/projects/$pid',
        params: {wid: workspace.id, pid: project.id},
      });
    } catch (error) {
      const copy = projectErrorCopy(error);
      if (copy.existingProjectId) {
        await queryClient.invalidateQueries({
          queryKey: projectsQueryKeys.exists(workspace.id),
          refetchType: 'active',
        });
        await queryClient.invalidateQueries({queryKey: projectsQueryKeys.list(workspace.id)});
        toast.info('Project already exists.');
        await navigate({
          to: '/workspaces/$wid/projects/$pid',
          params: {wid: workspace.id, pid: copy.existingProjectId},
        });
        return;
      }
      setFormError(`${copy.title}: ${copy.message}`);
      requestAnimationFrame(() => errorRef.current?.focus());
    }
  }

  const showRepoPicker = Boolean(selectedConnection);
  const filteredEmptyMessage = trimmedFilter
    ? `No repositories matching "${repoFilter.trim()}".`
    : 'No repositories visible to this connection.';

  return (
    <div className="flex w-full flex-col gap-24">
      <header className="flex flex-col gap-6">
        <Header id="create-project-title" variant="h1">
          Create project
        </Header>
        <Text size="sm" className="text-foreground-neutral-muted">
          A Shipfox project starts from a Git repository. Choose the repository Shipfox should
          track, then give the project a name.
        </Text>
      </header>

      <ModelProviderReminderBanner workspaceId={workspace.id} />

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

      <form
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
        noValidate
        aria-labelledby="create-project-title"
        className="grid items-start gap-32 lg:grid-cols-[minmax(0,1fr)_340px]"
      >
        <div className="flex min-w-0 flex-col gap-32">
          <section className="flex flex-col gap-16" aria-label="Source integration">
            <div className="flex items-start justify-between gap-16">
              <div className="flex flex-col gap-4">
                <Header variant="h3">Source integration</Header>
                <Text size="sm" className="text-foreground-neutral-muted">
                  Choose the integration that can access the repository.
                </Text>
              </div>

              {connections.length === 1 ? (
                <Button asChild variant="transparent" size="sm" className="shrink-0">
                  <Link to="/workspaces/$wid/integrations" params={{wid: workspace.id}}>
                    Add another integration
                  </Link>
                </Button>
              ) : null}
            </div>

            {connections.length > 0 ? (
              <ConnectionPicker
                connections={connections}
                selectedConnectionId={effectiveSelectedConnectionId}
                onSelect={selectConnection}
              />
            ) : null}
          </section>

          {showRepoPicker ? (
            <section className="flex flex-col gap-16" aria-label="Repository">
              <div className="flex flex-col gap-4">
                <Header variant="h3">Repository</Header>
                <Text size="sm" className="text-foreground-neutral-muted">
                  Select the repository this project tracks.
                </Text>
              </div>

              <RepositoryPicker
                repositories={repositories}
                selectedRepositoryId={selectedRepositoryId}
                onSelect={setSelectedRepositoryId}
                isLoading={repositoriesQuery.isPending}
                isFetchingNextPage={repositoriesQuery.isFetchingNextPage}
                hasNextPage={repositoriesQuery.hasNextPage}
                onLoadMore={() => repositoriesQuery.fetchNextPage()}
                emptyMessage={filteredEmptyMessage}
                searchValue={repoFilter}
                onSearchChange={setRepoFilter}
              />
            </section>
          ) : null}
        </div>

        <aside className="lg:sticky lg:top-32">
          <div className="flex flex-col gap-18 rounded-8 border border-border-neutral-base bg-background-neutral-base p-20">
            <div className="flex flex-col gap-4">
              <Header variant="h3">Project details</Header>
              <Text size="sm" className="text-foreground-neutral-muted">
                Confirm the source and create the project.
              </Text>
            </div>

            {formError ? (
              <Alert variant="error" animated={false}>
                <div ref={errorRef} tabIndex={-1}>
                  {formError}
                </div>
              </Alert>
            ) : null}

            <ProjectSummary
              connection={selectedConnection}
              repositoryName={selectedRepository?.full_name}
            />

            <form.Field
              name="name"
              validators={{
                onBlur: ({value}) =>
                  displayNameFieldError(value, 'Project name', createProjectBodySchema.shape.name),
                onSubmit: ({value}) =>
                  displayNameFieldError(value, 'Project name', createProjectBodySchema.shape.name),
              }}
            >
              {(field) => (
                <FormField label="Project name" id="project-name" error={fieldError(field)}>
                  <FormFieldInput
                    name="name"
                    type="text"
                    value={field.state.value}
                    onChange={(event) => {
                      setNameTouched(true);
                      field.handleChange(event.target.value);
                    }}
                    onBlur={field.handleBlur}
                    placeholder="Platform"
                  />
                </FormField>
              )}
            </form.Field>

            <Button
              type="submit"
              iconRight="chevronRight"
              isLoading={createProject.isPending}
              disabled={!selectedConnection || !selectedRepository}
              className="w-full"
            >
              Create project
            </Button>
          </div>
        </aside>
      </form>
    </div>
  );
}

function ProjectSummary({
  connection,
  repositoryName,
}: {
  connection: IntegrationConnectionDto | undefined;
  repositoryName: string | undefined;
}) {
  return (
    <div className="flex min-w-0 items-center gap-10">
      {repositoryName ? (
        <IntegrationIcon
          source={connection?.provider}
          aria-hidden
          className="size-20 shrink-0 text-foreground-neutral-base"
        />
      ) : null}
      <Text
        size="sm"
        bold
        className={repositoryName ? 'min-w-0 truncate' : 'text-foreground-neutral-muted'}
      >
        {repositoryName ?? 'Pick a repository'}
      </Text>
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

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}

function setWorkspaceProjectExists(
  queryClient: QueryClient,
  workspaceId: string,
  project: ProjectResponseDto,
) {
  queryClient.setQueryData<ListProjectsResponseDto>(projectsQueryKeys.exists(workspaceId), {
    projects: [project],
    next_cursor: null,
  });
}
