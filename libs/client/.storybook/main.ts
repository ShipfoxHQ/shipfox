import {createRequire} from 'node:module';
import type {StorybookConfig} from '@storybook/react-vite';

const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../src/**/*.stories.@(js|jsx|ts|tsx|mdx)'],
  addons: ['storybook-addon-pseudo-states', '@storybook/addon-vitest'],
  core: {
    disableTelemetry: true,
  },
  viteFinal: async (config) => {
    const require = createRequire(`${process.cwd()}/package.json`);
    const {default: tailwindcss} = await import(require.resolve('@tailwindcss/vite'));

    config.plugins = config.plugins ?? [];
    config.plugins.push(tailwindcss());
    if (process.env.CI === 'true') {
      const {createWorkspaceDistInternalImportResolverPlugin} = await import(
        require.resolve('@shipfox/vitest')
      );
      // Storybook owns its browser Vite server, so CI needs the same built-dist
      // internal import resolver that @shipfox/vitest installs for Vitest projects.
      config.plugins.push(createWorkspaceDistInternalImportResolverPlugin(process.cwd()));
    }

    return config;
  },
};

export default config;
