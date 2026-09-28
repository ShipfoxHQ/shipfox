import {useMaybeActiveWorkspace} from '@shipfox/client-shell/runtime';
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
 */
export function ProjectFirstWorkflowPanel({projectId, workspace}: ProjectFirstWorkflowPanelProps) {
  const activeWorkspace = useMaybeActiveWorkspace();
  const panelWorkspace = workspace ?? activeWorkspace;
  const {progress} = useFirstWorkflowState({scope: {kind: 'project', projectId}});

  if (!panelWorkspace || !progress || progress.state === 'done') return null;

  return (
    <FirstWorkflowPanel workspace={panelWorkspace} progress={progress} surface="workflows_empty" />
  );
}
