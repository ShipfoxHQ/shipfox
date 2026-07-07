import type {BaseLayoutProps} from 'fumadocs-ui/layouts/shared';
import {basePath} from '@/url';

/**
 * Shared layout configurations
 *
 * you can customise layouts individually from:
 * Home Layout: app/(home)/layout.tsx
 * Docs Layout: app/docs/layout.tsx
 */
export const baseOptions: BaseLayoutProps = {
  nav: {
    title: (
      <div className="flex items-center px-4">
        <picture>
          {/* Dark-background lockup (white wordmark + orange mark). Served from
              public/ under the /docs basePath. */}
          <img src={`${basePath}/logo.svg`} alt="Shipfox" className="max-h-6" />
        </picture>
      </div>
    ),
    url: 'https://www.shipfox.io',
  },
  themeSwitch: {enabled: false},
};
