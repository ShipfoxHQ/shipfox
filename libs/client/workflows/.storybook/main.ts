import type {StorybookConfig} from '@storybook/react-vite';

const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../src/**/*.stories.@(js|jsx|ts|tsx|mdx)'],
  addons: ['storybook-addon-pseudo-states', '@storybook/addon-vitest'],
  core: {
    disableTelemetry: true,
  },
  viteFinal: async (config) => {
    const [{default: react}, {default: tailwindcss}] = await Promise.all([
      import('@vitejs/plugin-react'),
      import('@tailwindcss/vite'),
    ]);

    config.plugins = config.plugins ?? [];
    config.plugins.push(react(), tailwindcss());

    return config;
  },
};

export default config;
