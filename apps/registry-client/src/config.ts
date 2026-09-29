import {createConfig, url} from '@shipfox/config';

export const config = createConfig({
  REGISTRY_URL: url({
    desc: 'Base URL of the registry API that every page reads, such as https://api.registry.shipfox.io. Pages read it on the server only.',
    default: 'https://api.registry.shipfox.io',
  }),
  REGISTRY_CLIENT_PUBLIC_URL: url({
    desc: 'Public URL of these pages, including the /registry path, such as https://www.shipfox.io/registry. Canonical links and the sitemap use it.',
    default: 'https://www.shipfox.io/registry',
  }),
});
