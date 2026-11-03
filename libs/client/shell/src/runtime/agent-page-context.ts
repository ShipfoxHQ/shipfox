import {atom, useAtomValue, useSetAtom} from 'jotai';
import {useEffect} from 'react';

/**
 * `runNumber` and `name` only label the page for the reader. The agent gets ids and reads the
 * rest through its tools.
 */
export type AgentPageContext =
  | {page: 'runs'}
  | {
      page: 'run';
      runId: string;
      runNumber?: number | undefined;
      attempt?: number | undefined;
      status?: string | undefined;
    }
  | {
      page: 'job';
      runId: string;
      runNumber?: number | undefined;
      attempt?: number | undefined;
      jobId: string;
      stepId?: string | undefined;
      status?: string | undefined;
    }
  | {page: 'workflows'}
  | {page: 'workflow'; definitionId: string; name?: string | undefined}
  | {page: 'project_settings'; section: string};

// One object per registration, so a late cleanup can tell its entry from a newer
// page's, even when both pages publish the same values.
const registeredPageContextAtom = atom<{serialized: string} | undefined>(undefined);

const agentPageContextAtom = atom((get) => {
  const registered = get(registeredPageContextAtom);
  return registered && (JSON.parse(registered.serialized) as AgentPageContext);
});

/**
 * Tells the shell which page the user is on, until the page unmounts. A page
 * calls this with what it knows, and calls it again as more data loads. The
 * shell keeps one value, so call it once per page and never from a nested layout.
 * Pass `undefined` while the page can't say which resource it shows.
 */
export function useAgentPageContext(context: AgentPageContext | undefined): void {
  const register = useSetAtom(registeredPageContextAtom);
  // Serialized so a page can pass a fresh object on every render without re-registering.
  const serialized = context === undefined ? undefined : JSON.stringify(context);
  useEffect(() => {
    if (serialized === undefined) return;
    const entry = {serialized};
    register(entry);
    return () => register((current) => (current === entry ? undefined : current));
  }, [register, serialized]);
}

/** The context the current page registered. It is a hint, never authority. */
export function useCurrentAgentPageContext(): AgentPageContext | undefined {
  return useAtomValue(agentPageContextAtom);
}
