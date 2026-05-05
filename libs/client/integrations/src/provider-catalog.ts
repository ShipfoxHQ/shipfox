import type {IconName} from '@shipfox/react-ui';

export interface ProviderCatalogEntry {
  iconName: IconName;
  setupPath: string;
}

export const PROVIDER_CATALOG: Record<string, ProviderCatalogEntry> = {
  github: {
    iconName: 'github',
    setupPath: '/setup/integrations/github',
  },
  debug: {
    iconName: 'componentLine',
    setupPath: '/setup/integrations/debug',
  },
};
