import type {BaseLayoutProps} from 'fumadocs-ui/layouts/shared';

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
          <img
            src="https://a.storyblok.com/f/338460/971x200/e86f43be28/shipfox-logotype-orange-black.svg"
            alt="Shipfox"
            className="max-h-8"
          />
        </picture>
      </div>
    ),
    url: 'https://www.shipfox.io',
  },
  themeSwitch: {enabled: false},
};
