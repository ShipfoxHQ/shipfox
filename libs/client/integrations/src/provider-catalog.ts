import type {IconName} from '@shipfox/react-ui/icon';

// Literal union (not string) so `<Link to={catalog.setupPath}>` stays typed
// against TanStack Router's route tree.
export type ProviderSetupPath =
  | '/workspaces/$wid/integrations/github'
  | '/workspaces/$wid/integrations/gitea'
  | '/workspaces/$wid/integrations/sentry'
  | '/workspaces/$wid/integrations/linear';

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
    iconName: 'github',
    setupPath: '/workspaces/$wid/integrations/github',
  },
  sentry: {
    kind: 'redirect-install',
    iconName: 'sentry',
    setupPath: '/workspaces/$wid/integrations/sentry',
  },
  linear: {
    kind: 'redirect-install',
    iconName: 'linear',
    setupPath: '/workspaces/$wid/integrations/linear',
  },
  gitea: {
    kind: 'direct-connect',
    iconName: 'gitea',
    setupPath: '/workspaces/$wid/integrations/gitea',
  },
  webhook: {
    kind: 'modal-connect',
    iconName: 'webhookLine',
  },
};
