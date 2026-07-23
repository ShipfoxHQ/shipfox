import '@shipfox/react-ui/index.css';
import './preview.css';
import {ThemeProvider} from '@shipfox/react-ui/theme';
import type {Decorator, Preview} from '@storybook/react';

const withTheme: Decorator = (Story, context) => {
  const theme = context.globals.theme;

  return (
    <ThemeProvider key={theme} defaultTheme={theme} storageKey={`shipfox-storybook-theme-${theme}`}>
      <Story />
    </ThemeProvider>
  );
};

const preview: Preview = {
  decorators: [withTheme],
  globalTypes: {
    theme: {
      name: 'Theme',
      description: 'Global theme for the Storybook shell',
      defaultValue: 'system',
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
  parameters: {
    options: {
      storySort: {method: 'alphabetical'},
    },
  },
};

export default preview;
