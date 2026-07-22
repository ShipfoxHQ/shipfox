import {PROVIDER_ICONS} from '@shipfox/integration-icons';
import type {IconName} from '@shipfox/react-ui/icon';

// Literal union (not string) so `<Link to={catalog.setupPath}>` stays typed
// against TanStack Router's route tree.
export type ProviderSetupPath =
  | '/workspaces/$wid/integrations/github'
  | '/workspaces/$wid/integrations/gitea'
  | '/workspaces/$wid/integrations/sentry'
  | '/workspaces/$wid/integrations/linear'
  | '/workspaces/$wid/integrations/slack';

interface RouteProviderCatalogEntry {
  kind: 'redirect-install' | 'direct-connect';
  iconName: IconName;
  setupPath: ProviderSetupPath;
}

interface ModalProviderCatalogEntry {
  kind: 'modal-connect';
  iconName: IconName;
}

export type ProviderCatalogEntry = RouteProviderCatalogEntry | ModalProviderCatalogEntry;

export const PROVIDER_CATALOG: Record<string, ProviderCatalogEntry> = {
  github: {
    kind: 'redirect-install',
    iconName: PROVIDER_ICONS.github,
    setupPath: '/workspaces/$wid/integrations/github',
  },
  sentry: {
    kind: 'redirect-install',
    iconName: PROVIDER_ICONS.sentry,
    setupPath: '/workspaces/$wid/integrations/sentry',
  },
  linear: {
    kind: 'redirect-install',
    iconName: PROVIDER_ICONS.linear,
    setupPath: '/workspaces/$wid/integrations/linear',
  },
  slack: {
    kind: 'redirect-install',
    iconName: PROVIDER_ICONS.slack,
    setupPath: '/workspaces/$wid/integrations/slack',
  },
  gitea: {
    kind: 'direct-connect',
    iconName: PROVIDER_ICONS.gitea,
    setupPath: '/workspaces/$wid/integrations/gitea',
  },
  webhook: {
    kind: 'modal-connect',
    iconName: PROVIDER_ICONS.webhook,
  },
};
