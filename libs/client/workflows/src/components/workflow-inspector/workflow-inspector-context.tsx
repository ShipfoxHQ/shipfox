import {createContext, type ReactNode, useContext, useMemo} from 'react';
import type {WorkflowInspectorScope} from '#routes/inputs.js';

export type OpenWorkflowInspector = (
  scope: WorkflowInspectorScope,
  trigger: HTMLButtonElement,
) => void;

interface WorkflowInspectorContextValue {
  onOpen: OpenWorkflowInspector;
  /** The scope the host is showing, so entry buttons can show as pressed. */
  scope: WorkflowInspectorScope | undefined;
}

const WorkflowInspectorOpenContext = createContext<WorkflowInspectorContextValue | undefined>(
  undefined,
);

export function WorkflowInspectorOpenProvider({
  onOpen,
  scope,
  children,
}: {
  onOpen: OpenWorkflowInspector;
  scope: WorkflowInspectorScope | undefined;
  children: ReactNode;
}) {
  const value = useMemo(() => ({onOpen, scope}), [onOpen, scope]);
  return (
    <WorkflowInspectorOpenContext.Provider value={value}>
      {children}
    </WorkflowInspectorOpenContext.Provider>
  );
}

export function useOpenWorkflowInspector(): OpenWorkflowInspector | undefined {
  return useContext(WorkflowInspectorOpenContext)?.onOpen;
}

export function useOpenWorkflowInspectorScope(): WorkflowInspectorScope | undefined {
  return useContext(WorkflowInspectorOpenContext)?.scope;
}
