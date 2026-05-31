import {useActiveWorkspace, WorkspaceCrumb} from '@shipfox/client-auth';
import {
  ProjectCrumb,
  useLocalWorkflowRunQuery,
  useLocalWorkflowStatusQuery,
  useProjectQuery,
} from '@shipfox/client-projects';
import {Code, Logo, StatusBadge, Text} from '@shipfox/react-ui';
import {Link, useParams} from '@tanstack/react-router';
import {UserMenu} from './user-menu.js';

export function NavBar() {
  const workspace = useActiveWorkspace();
  const params = useParams({strict: false}) as {pid?: string; runId?: string};
  const projectQuery = useProjectQuery(params.pid);
  const project = projectQuery.data;
  const runQuery = useLocalWorkflowRunQuery(project?.id, params.runId);
  const run = runQuery.data?.run?.run;
  const statusQuery = useLocalWorkflowStatusQuery(params.runId ? project?.id : undefined);

  if (params.runId) {
    return (
      <header className="sticky top-0 z-30 flex h-56 shrink-0 items-center gap-18 border-b border-border-neutral-base bg-background-subtle-base px-24">
        <Link
          to="/"
          aria-label="Shipfox home"
          className="rounded-6 focus-visible:outline-none focus-visible:shadow-button-secondary-focus"
        >
          <Logo variant="wordmark" />
        </Link>
        <div className="flex min-w-0 flex-1 items-center gap-8 text-foreground-neutral-muted">
          <Text size="md" className="max-w-220 shrink-0 truncate">
            {workspace.name}
          </Text>
          <span aria-hidden="true">/</span>
          <Text size="md" className="shrink-0 truncate">
            {project?.name ?? 'Project'}
          </Text>
          <span aria-hidden="true">/</span>
          <Text size="md" className="shrink-0 truncate">
            {run?.workflow_name ?? 'Run'}
          </Text>
          <span aria-hidden="true">/</span>
          <Code className="min-w-0 truncate text-foreground-neutral-muted">{params.runId}</Code>
        </div>
        <div className="flex-1" />
        <StatusBadge variant={statusQuery.data?.reachable === false ? 'error' : 'success'}>
          {statusQuery.data?.reachable === false ? 'service unavailable' : 'service ready'}
        </StatusBadge>
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-30 flex h-56 shrink-0 items-center gap-12 border-b border-border-neutral-base bg-background-subtle-base px-16">
      <Link
        to="/"
        aria-label="Shipfox home"
        className="rounded-6 focus-visible:outline-none focus-visible:shadow-button-secondary-focus"
      >
        <Logo variant="wordmark" />
      </Link>
      <span className="h-20 w-px bg-border-neutral-base" aria-hidden="true" />
      <WorkspaceCrumb workspace={workspace} />
      <span className="text-foreground-neutral-muted" aria-hidden="true">
        /
      </span>
      <ProjectCrumb
        workspaceId={workspace.id}
        projectId={project?.id}
        projectName={project?.name}
      />
      <div className="flex-1" />
      <UserMenu />
    </header>
  );
}
