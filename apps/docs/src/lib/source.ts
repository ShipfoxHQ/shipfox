import {docs} from 'collections/server';
import type {LoaderPlugin} from 'fumadocs-core/source';
import {loader} from 'fumadocs-core/source';
import {statusBadgesPlugin} from 'fumadocs-core/source/status-badges';
import {icons} from 'lucide-react';
import {createElement} from 'react';
import {siClickup, siGithub, siJira, siLinear, siSentry, siSlack} from 'simple-icons';
import {
  isRegisteredCatalogIntegrationProvider,
  sortRegisteredIntegrationProviders,
} from '@/lib/registered-integration-providers';

const simpleIcons = {
  clickup: siClickup,
  github: siGithub,
  jira: siJira,
  sentry: siSentry,
  linear: siLinear,
  slack: siSlack,
};

// Sidebar shows the shorter `sidebarTitle` frontmatter (e.g. "Jobs & Steps")
// while the page keeps its descriptive `title` as the H1. Runs before
// the status-badges plugin so the badge is appended to the overridden label.
const sidebarTitlePlugin: LoaderPlugin = {
  name: 'shipfox:sidebar-title',
  transformPageTree: {
    file(node, filePath) {
      if (!filePath) return node;
      const file = this.storage.read(filePath);
      if (file?.format === 'page') {
        const sidebarTitle = (file.data as {sidebarTitle?: unknown}).sidebarTitle;
        if (typeof sidebarTitle === 'string') node.name = sidebarTitle;
      }
      return node;
    },
  },
};

const integrationProviderOrderPlugin: LoaderPlugin = {
  name: 'shipfox:integration-provider-order',
  transformPageTree: {
    folder(node, folderPath) {
      if (folderPath !== 'integrations') return node;

      const providers = node.children.flatMap((child) => {
        if (child.type !== 'folder') return [];
        const slug = child.$ref?.folder.split('/').at(-1);
        if (!slug || !isRegisteredCatalogIntegrationProvider(slug)) return [];
        return [{slug, name: typeof child.name === 'string' ? child.name : slug, child}];
      });
      const providerNodes: ReadonlySet<(typeof node.children)[number]> = new Set(
        providers.map(({child}) => child),
      );

      return {
        ...node,
        children: [
          ...sortRegisteredIntegrationProviders(providers).map(({child}) => child),
          ...node.children.filter((child) => !providerNodes.has(child)),
        ],
      };
    },
  },
};

// See https://fumadocs.vercel.app/docs/headless/source-api for more info
export const source = loader({
  // it assigns a URL to your pages
  baseUrl: '/',
  source: docs.toFumadocsSource(),
  plugins: [
    integrationProviderOrderPlugin,
    sidebarTitlePlugin,
    statusBadgesPlugin({
      renderBadge: (status) =>
        createElement(
          'span',
          {
            className:
              'ms-inline inline-flex items-center rounded bg-fd-primary/10 p-tight text-[10px] font-medium uppercase tracking-wide text-fd-primary',
          },
          status === 'soon' ? 'Soon' : status,
        ),
    }),
  ],
  icon(icon) {
    if (!icon) return;
    if (icon in icons) return createElement(icons[icon as keyof typeof icons]);
    if (icon.startsWith('si:') || icon in simpleIcons) {
      const key = (icon.startsWith('si:') ? icon.slice(3) : icon) as keyof typeof simpleIcons;
      const si = simpleIcons[key];
      if (si)
        return createElement(
          'svg',
          {
            key: icon,
            role: 'img',
            viewBox: '0 0 24 24',
            fill: 'currentColor',
            width: '1em',
            height: '1em',
          },
          createElement('path', {d: si.path}),
        );
    }
  },
});
