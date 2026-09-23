import {useProjectQuery} from '@shipfox/client-projects';
import {Text} from '@shipfox/react-ui/typography';
import {cn} from '@shipfox/react-ui/utils';
import {Link} from '@tanstack/react-router';
import type {WorkflowRunParent} from '#core/workflow-run.js';
import {withoutWorkflowRunScopedSearch} from '#core/workflow-run-url-state.js';

export function WorkflowRunParentLabel({
  parentRun,
  runProjectId,
  workspaceSlug,
  projectSlug,
  className,
}: {
  parentRun: WorkflowRunParent;
  runProjectId: string;
  workspaceSlug?: string | undefined;
  projectSlug?: string | undefined;
  className?: string | undefined;
}) {
  const label = `Started by ${parentRun.name} #${parentRun.number}`;
  if (!workspaceSlug || !projectSlug) return <ParentRunText label={label} className={className} />;

  if (parentRun.projectId === runProjectId) {
    return (
      <Link
        to="/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId"
        params={{workspaceSlug, projectSlug, workflowRunId: parentRun.id}}
        search={withoutWorkflowRunScopedSearch as never}
        className={cn(className, 'pointer-events-auto')}
      >
        <Text as="span" size="xs">
          {label}
        </Text>
      </Link>
    );
  }

  return (
    <CrossProjectParentRunLink
      parentRun={parentRun}
      workspaceSlug={workspaceSlug}
      label={label}
      className={className}
    />
  );
}

function CrossProjectParentRunLink({
  parentRun,
  workspaceSlug,
  label,
  className,
}: {
  parentRun: WorkflowRunParent;
  workspaceSlug: string;
  label: string;
  className?: string | undefined;
}) {
  const projectQuery = useProjectQuery(parentRun.projectId);
  const resolvedProjectSlug = projectQuery.data?.slug;
  if (!resolvedProjectSlug) return <ParentRunText label={label} className={className} />;

  return (
    <Link
      to="/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId"
      params={{
        workspaceSlug,
        projectSlug: resolvedProjectSlug,
        workflowRunId: parentRun.id,
      }}
      search={withoutWorkflowRunScopedSearch as never}
      className={cn(className, 'pointer-events-auto')}
    >
      <Text as="span" size="xs">
        {label}
      </Text>
    </Link>
  );
}

function ParentRunText({label, className}: {label: string; className?: string | undefined}) {
  return (
    <Text as="span" size="xs" className={cn(className, 'pointer-events-none')}>
      {label}
    </Text>
  );
}
