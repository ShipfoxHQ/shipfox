import {atom, useAtomValue, useSetAtom} from 'jotai';
import {useEffect} from 'react';

export type AgentPageContext =
  | {page: 'runs'}
  | {page: 'run'; runId: string; attempt?: number | undefined; status?: string | undefined}
  | {
      page: 'job';
      runId: string;
      attempt?: number | undefined;
      jobId: string;
      stepId?: string | undefined;
      status?: string | undefined;
    }
  | {page: 'workflows'}
  | {page: 'workflow'; definitionId: string}
  | {page: 'project_settings'; section: string};

// Serialized so a page can pass a fresh object on every render without
// re-registering, and so a late cleanup can tell its value from a newer page's.
const registeredPageContextAtom = atom<string | undefined>(undefined);

const agentPageContextAtom = atom((get) => {
  const registered = get(registeredPageContextAtom);
  return registered === undefined ? undefined : (JSON.parse(registered) as AgentPageContext);
});

/**
 * Tells the shell which page the user is on, until the page unmounts. A page
 * calls this with what it knows, and calls it again as more data loads. The
 * shell keeps one value, so call it once per page and never from a nested layout.
 */
export function useAgentPageContext(context: AgentPageContext): void {
  const register = useSetAtom(registeredPageContextAtom);
  const serialized = JSON.stringify(context);
  useEffect(() => {
    register(serialized);
    return () => register((current) => (current === serialized ? undefined : current));
  }, [register, serialized]);
}

/** The context the current page registered. It is a hint, never authority. */
export function useCurrentAgentPageContext(): AgentPageContext | undefined {
  return useAtomValue(agentPageContextAtom);
}
