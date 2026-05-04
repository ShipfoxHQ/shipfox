export interface ProviderCatalogEntry {
  description: string;
  setupPath: string;
}

export const PROVIDER_CATALOG: Record<string, ProviderCatalogEntry> = {
  github: {
    description: 'Install the Shipfox GitHub App on the repositories you want to import.',
    setupPath: '/setup/integrations/github',
  },
  debug: {
    description: 'Three local fixture repositories for development and tests.',
    setupPath: '/setup/integrations/debug',
  },
};
