import {
  type BrowserStorageKey,
  createTypedBrowserStorage,
  localStorageOrUndefined,
} from '@shipfox/client-ui';
import {useMediaQuery} from '@shipfox/react-ui/hooks/useMediaQuery';
import {useAtom} from 'jotai';
import type {PropsWithChildren} from 'react';
import {createContext, useContext, useMemo} from 'react';
import type {ClientFeature, ProjectDockContribution} from '#contract.js';
import {persistedAtom} from '#runtime/persisted-atom.js';

/** Below this width the dock is a full-screen sheet and Shippy stays in the tab bar. */
export const PROJECT_DOCK_QUERY = '(min-width: 976px)';

export type ShippyPlacement = 'floating' | 'tab_bar';

const shippyPlacementKey = {
  key: 'shipfox.shippy.placement',
  lifetime: 'persistent',
  principalScope: 'global',
  serialize: (placement: ShippyPlacement) => placement,
  parse: (raw: string) => (raw === 'floating' || raw === 'tab_bar' ? raw : undefined),
} satisfies BrowserStorageKey<ShippyPlacement>;

const projectDockOpenKey = {
  key: 'shipfox.projectDock.open',
  lifetime: 'persistent',
  principalScope: 'global',
  serialize: (open: boolean) => String(open),
  parse: (raw: string) => {
    if (raw === 'true') return true;
    return raw === 'false' ? false : undefined;
  },
} satisfies BrowserStorageKey<boolean>;

const shippyPlacementAtom = persistedAtom(
  createTypedBrowserStorage(localStorageOrUndefined, shippyPlacementKey),
  'floating',
);

const projectDockOpenAtom = persistedAtom(
  createTypedBrowserStorage(localStorageOrUndefined, projectDockOpenKey),
  false,
  // Below this width the panel is a modal sheet, which must not open by itself on page load.
  () => window.matchMedia(PROJECT_DOCK_QUERY).matches,
);

export function useProjectDock(): {open: boolean; setOpen: (open: boolean) => void} {
  const [open, setOpen] = useAtom(projectDockOpenAtom);
  return {open, setOpen};
}

export function useShippyPlacement(): {
  /** The placement in effect, which the viewport can override. */
  placement: ShippyPlacement;
  canFloat: boolean;
  setPlacement: (placement: ShippyPlacement) => void;
} {
  const canFloat = useMediaQuery(PROJECT_DOCK_QUERY);
  const [stored, setPlacement] = useAtom(shippyPlacementAtom);
  return {placement: canFloat ? stored : 'tab_bar', canFloat, setPlacement};
}

const ProjectDockContext = createContext<ProjectDockContribution | undefined>(undefined);

export function ProjectDockProvider({
  features,
  children,
}: PropsWithChildren<{features: readonly ClientFeature[]}>) {
  const dock = useMemo(
    () => features.find((feature) => feature.projectDock)?.projectDock,
    [features],
  );
  return <ProjectDockContext.Provider value={dock}>{children}</ProjectDockContext.Provider>;
}

export function useProjectDockContribution(): ProjectDockContribution | undefined {
  return useContext(ProjectDockContext);
}
