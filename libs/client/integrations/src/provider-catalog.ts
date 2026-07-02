import type {IconName} from '@shipfox/react-ui/icon';

// Literal union (not string) so `<Link to={catalog.setupPath}>` stays typed
// against TanStack Router's route tree.
export type ProviderSetupPath =
  | '/workspaces/$wid/integrations/github'
  | '/workspaces/$wid/integrations/gitea'
  | '/workspaces/$wid/integrations/debug'
  | '/workspaces/$wid/integrations/sentry';

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
  gitea: {
    kind: 'direct-connect',
    iconName: 'gitea',
    setupPath: '/workspaces/$wid/integrations/gitea',
  },
  debug: {
    kind: 'direct-connect',
    iconName: 'componentLine',
    setupPath: '/workspaces/$wid/integrations/debug',
  },
  webhook: {
    kind: 'modal-connect',
    iconName: 'webhookLine',
  },
};
