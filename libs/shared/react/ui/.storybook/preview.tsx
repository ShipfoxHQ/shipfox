import '../index.css';
import type {Decorator, Preview} from '@storybook/react';
import {ThemeProvider} from '#components/theme/index.js';

const withTheme: Decorator = (Story, context) => {
  const theme = context.globals.theme;
  return (
    <ThemeProvider key={theme} defaultTheme={theme} storageKey={`shipfox-theme-${theme}`}>
      {Story()}
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
    viewport: {
      viewports: {
        large: {
          name: 'Large Viewport',
          styles: {
            width: '1280px',
            height: '2000px',
          },
        },
        extraLarge: {
          name: 'Extra Large Viewport',
          styles: {
            width: '1920px',
            height: '2000px',
          },
        },
      },
    },
    options: {
      storySort: {
        method: 'alphabetical',
      },
    },
  },
  globalTypes: {
    theme: {
      name: 'Theme',
      description: 'Global theme for components',
      defaultValue: 'system',
      toolbar: {
        icon: 'sun',
        items: [
          {
            value: 'light',
            icon: 'sun',
            title: 'Light',
          },
          {
            value: 'dark',
            icon: 'moon',
            title: 'Dark',
          },
          {
            value: 'system',
            icon: 'info',
            title: 'System',
          },
        ],
        showName: true,
      },
    },
  },
};

export default preview;
