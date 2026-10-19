import {type Definition, useDefinitionsInfiniteQuery} from '@shipfox/client-projects';
import {useOptionalChrome} from '@shipfox/client-shell/runtime';
import {toast} from '@shipfox/react-ui/toast';
import {type ReactNode, useMemo} from 'react';
import {useFireManualWorkflowMutation} from '#hooks/api/workflow-runs.js';
import {
  WorkflowRunListDevRunsNotice,
  WorkflowRunListNoRuns,
  WorkflowRunListSetup,
} from './workflow-run-list-setup.js';

export interface RunListSetup {
  isPending: boolean;
  leading?: ReactNode;
  notice?: ReactNode;
  emptyState?: ReactNode;
}

const NO_SETUP: RunListSetup = {isPending: false};

/**
 * The setup content of a project without a live run. It reads the project's workflows only
 * while `enabled`, so a project with live runs pays nothing for it.
 */
export function useRunListSetup({
  projectId,
  enabled,
}: {
  projectId: string;
  enabled: boolean;
}): RunListSetup {
  const definitionsQuery = useDefinitionsInfiniteQuery(enabled ? projectId : undefined);
  const fireManual = useFireManualWorkflowMutation();
  const FirstWorkflowPanel = useOptionalChrome()?.FirstWorkflowPanel;
  const definitions = useMemo<Definition[]>(
    () => definitionsQuery.data?.pages.flatMap((page) => page.definitions) ?? [],
    [definitionsQuery.data],
  );

  if (!enabled) return NO_SETUP;
  // A failed workflows read still leaves the dev runs worth showing, just without the panels.
  if (definitionsQuery.isError) return {isPending: false, notice: <WorkflowRunListDevRunsNotice />};
  if (definitionsQuery.isPending) return {isPending: true};

  const sync = definitionsQuery.data.pages[0]?.sync ?? null;

  async function handleRunDefinition(definition: Definition) {
    try {
      await fireManual.mutateAsync({projectId, definitionId: definition.id});
      toast.success('Run queued');
    } catch {
      toast.error('Could not start the run');
    }
  }

  return {
    isPending: false,
    leading: (
      <WorkflowRunListSetup
        sync={sync}
        firstWorkflowPanel={
          FirstWorkflowPanel ? <FirstWorkflowPanel projectId={projectId} /> : null
        }
        definitions={definitions}
        onRunDefinition={(definition) => void handleRunDefinition(definition)}
        runningDefinitionId={
          fireManual.isPending ? (fireManual.variables?.definitionId ?? null) : null
        }
      />
    ),
    notice: <WorkflowRunListDevRunsNotice />,
    emptyState: <WorkflowRunListNoRuns defaultBranch={sync?.ref ?? null} />,
  };
}
