import './preview.css';
import {ThemeProvider} from '@shipfox/react-ui';
import type {Decorator, Preview} from '@storybook/react';

const withTheme: Decorator = (Story, context) => {
  const theme = context.globals.theme;
  return (
    <ThemeProvider key={theme} defaultTheme={theme} storageKey={`shipfox-theme-${theme}`}>
      <Story />
    </ThemeProvider>
  );
};

const preview: Preview = {
  decorators: [withTheme],
  parameters: {
    argos: {
      modes: {
        light: {theme: 'light'},
        dark: {theme: 'dark'},
      },
      fitToContent: false,
    },
    options: {
      storySort: {method: 'alphabetical'},
    },
  },
  globalTypes: {
    theme: {
      name: 'Theme',
      description: 'Global theme for components',
      defaultValue: 'dark',
      toolbar: {
        icon: 'sun',
        items: [
          {value: 'light', icon: 'sun', title: 'Light'},
          {value: 'dark', icon: 'moon', title: 'Dark'},
          {value: 'system', icon: 'info', title: 'System'},
        ],
        showName: true,
      },
    },
  },
};

export default preview;
