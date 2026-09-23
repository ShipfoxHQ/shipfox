import {createContext, type ReactNode, useContext} from 'react';
import type {WorkflowInspectorScope} from '#routes/inputs.js';

export type OpenWorkflowInspector = (
  scope: WorkflowInspectorScope,
  trigger: HTMLButtonElement,
) => void;

const WorkflowInspectorOpenContext = createContext<OpenWorkflowInspector | undefined>(undefined);

export function WorkflowInspectorOpenProvider({
  onOpen,
  children,
}: {
  onOpen: OpenWorkflowInspector;
  children: ReactNode;
}) {
  return (
    <WorkflowInspectorOpenContext.Provider value={onOpen}>
      {children}
    </WorkflowInspectorOpenContext.Provider>
  );
}

export function useOpenWorkflowInspector(): OpenWorkflowInspector | undefined {
  return useContext(WorkflowInspectorOpenContext);
}
