import type {IconName} from '@shipfox/react-ui';

// Literal union (not string) so `<Link to={catalog.setupPath}>` stays typed
// against TanStack Router's route tree.
export type ProviderSetupPath =
  | '/workspaces/$wid/integrations/github'
  | '/workspaces/$wid/integrations/debug'
  | '/workspaces/$wid/integrations/sentry';

export interface ProviderCatalogEntry {
  /**
   * Selects the shared install-page behavior: `redirect-install` providers render
   * the shared redirect-install page (mint install URL, leave the app);
   * `direct-connect` providers keep a bespoke page. Callback routes stay
   * bespoke per provider either way.
   */
  kind: 'redirect-install' | 'direct-connect';
  iconName: IconName;
  setupPath: ProviderSetupPath;
}

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
  debug: {
    kind: 'direct-connect',
    iconName: 'componentLine',
    setupPath: '/workspaces/$wid/integrations/debug',
  },
};
