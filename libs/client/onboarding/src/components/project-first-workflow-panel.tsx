import {useMaybeActiveWorkspace} from '@shipfox/client-shell/runtime';
import {Panel} from '@shipfox/react-ui/panel';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {useFirstWorkflowState} from '#hooks/api/first-workflow.js';
import {FirstWorkflowPanel} from './first-workflow-panel.js';
import type {WorkspaceReference} from './setup-checklist-types.js';

export interface ProjectFirstWorkflowPanelProps {
  projectId: string;
  /** A stable workspace makes the panel easy to compose in isolated surfaces and stories. */
  workspace?: WorkspaceReference;
}

/**
 * The first workflow panel for one project's empty workflows page. It reads the
 * project scope, so a definition or a test run in another project never moves
 * it, and it ignores the checklist's dismissal.
 *
 * The page shows this panel in place of its empty list, so it renders
 * something until the project has a definition: a skeleton while its progress
 * loads, and choose mode if that read fails.
 */
export function ProjectFirstWorkflowPanel({projectId, workspace}: ProjectFirstWorkflowPanelProps) {
  const activeWorkspace = useMaybeActiveWorkspace();
  const panelWorkspace = workspace ?? activeWorkspace;
  const {progress, isError} = useFirstWorkflowState({scope: {kind: 'project', projectId}});

  if (!panelWorkspace || progress?.state === 'done') return null;
  if (!progress && !isError) return <FirstWorkflowPanelSkeleton />;

  return (
    <FirstWorkflowPanel
      workspace={panelWorkspace}
      progress={progress ?? {state: 'open'}}
      surface="workflows_empty"
    />
  );
}

function FirstWorkflowPanelSkeleton() {
  return (
    <Panel>
      <div
        role="status"
        aria-label="Loading first workflow setup"
        className="flex flex-col gap-inline p-panel"
      >
        <Skeleton className="h-20 w-1/3" />
        <Skeleton className="h-16 w-2/3" />
        <Skeleton className="h-16 w-1/2" />
      </div>
    </Panel>
  );
}
