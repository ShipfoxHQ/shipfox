import {
  loadWorkspaceSetupRoute,
  ProjectBreadcrumb,
  ProjectLayoutGuard,
} from '@shipfox/client-projects';
import type {ChromeSlots, WorkspaceSetupGate} from '@shipfox/client-shell/runtime';

export const defaultChrome: ChromeSlots = {ProjectBreadcrumb, ProjectLayoutGuard};
export const defaultWorkspaceSetupGate: WorkspaceSetupGate = loadWorkspaceSetupRoute;
