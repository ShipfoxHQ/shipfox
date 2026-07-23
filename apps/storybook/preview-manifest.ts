export type StorybookManifestEntry = {
  readonly id: string;
  readonly title: string;
  readonly package: string;
  readonly order: number;
  readonly source: string;
  readonly path: `/${string}/`;
};

export const storybooks = [
  {
    id: 'react-ui',
    title: 'React UI',
    package: '@shipfox/react-ui',
    order: 1,
    source: 'libs/shared/react/ui/storybook-static',
    path: '/react-ui/',
  },
  {
    id: 'client-agent',
    title: 'Client Agent',
    package: '@shipfox/client-agent',
    order: 2,
    source: 'libs/client/agent/storybook-static',
    path: '/client-agent/',
  },
  {
    id: 'client-auth',
    title: 'Client Auth',
    package: '@shipfox/client-auth',
    order: 3,
    source: 'libs/client/auth/storybook-static',
    path: '/client-auth/',
  },
  {
    id: 'client-integrations',
    title: 'Client Integrations',
    package: '@shipfox/client-integrations',
    order: 4,
    source: 'libs/client/integrations/storybook-static',
    path: '/client-integrations/',
  },
  {
    id: 'client-logs',
    title: 'Client Logs',
    package: '@shipfox/client-logs',
    order: 5,
    source: 'libs/client/logs/storybook-static',
    path: '/client-logs/',
  },
  {
    id: 'client-projects',
    title: 'Client Projects',
    package: '@shipfox/client-projects',
    order: 6,
    source: 'libs/client/projects/storybook-static',
    path: '/client-projects/',
  },
  {
    id: 'client-runners',
    title: 'Client Runners',
    package: '@shipfox/client-runners',
    order: 7,
    source: 'libs/client/runners/storybook-static',
    path: '/client-runners/',
  },
  {
    id: 'client-secrets',
    title: 'Client Secrets',
    package: '@shipfox/client-secrets',
    order: 8,
    source: 'libs/client/secrets/storybook-static',
    path: '/client-secrets/',
  },
  {
    id: 'client-triggers',
    title: 'Client Triggers',
    package: '@shipfox/client-triggers',
    order: 9,
    source: 'libs/client/triggers/storybook-static',
    path: '/client-triggers/',
  },
  {
    id: 'client-workflows',
    title: 'Client Workflows',
    package: '@shipfox/client-workflows',
    order: 10,
    source: 'libs/client/workflows/storybook-static',
    path: '/client-workflows/',
  },
] as const satisfies readonly StorybookManifestEntry[];

export const storybookManifest = storybooks;

export type StorybookId = (typeof storybooks)[number]['id'];

export type StorybookRef = {
  title: string;
  url: string;
};

export const storybookRefs = Object.fromEntries(
  storybooks.map(({id, title, path}) => [id, {title, url: path}]),
) as Record<StorybookId, StorybookRef>;

export const storybookLinks = storybooks.map(({id, title, path}) => ({
  id,
  title,
  url: path,
}));

export const storybookTurboFilters = storybooks.map(({package: packageName}) => packageName);
