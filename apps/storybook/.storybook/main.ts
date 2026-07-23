import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {StorybookConfig} from '@storybook/react-vite';
import {storybookRefs, storybooks} from '../preview-manifest.js';

const configDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(configDir, '../../..');

const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../src/**/*.mdx'],
  addons: ['@storybook/addon-docs'],
  refs: storybookRefs,
  staticDirs: storybooks.map(({source, path}) => ({
    from: resolve(repositoryRoot, source),
    to: path,
  })),
  core: {
    disableTelemetry: true,
  },
  viteFinal: async (viteConfig) => {
    const [{default: react}, {default: tailwindcss}] = await Promise.all([
      import('@vitejs/plugin-react'),
      import('@tailwindcss/vite'),
    ]);

    viteConfig.plugins = viteConfig.plugins ?? [];
    viteConfig.plugins.push(react(), tailwindcss());

    return viteConfig;
  },
};

export default config;
