import '@shipfox/react-ui/index.css';
import './preview.css';
import {type Theme, ThemeProvider} from '@shipfox/react-ui/theme';
import {DocsContainer, type DocsContainerProps} from '@storybook/addon-docs/blocks';
import type {Decorator, Preview} from '@storybook/react';
import {useEffect, useState} from 'react';
import {GLOBALS_UPDATED} from 'storybook/internal/core-events';
import type {GlobalsUpdatedPayload} from 'storybook/internal/types';

function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system';
}

function getThemeFromParentUrl(): Theme {
  if (typeof window === 'undefined') return 'system';

  const globals = new URL(window.parent.location.href).searchParams.get('globals');
  const theme = globals
    ?.split(';')
    .find((global) => global.startsWith('theme:'))
    ?.slice(6);

  return isTheme(theme) ? theme : 'system';
}

function DesignSystemDocsContainer({children, context, theme: docsTheme}: DocsContainerProps) {
  const [theme, setTheme] = useState<Theme>(getThemeFromParentUrl);

  useEffect(() => {
    const onGlobalsUpdated = ({globals}: GlobalsUpdatedPayload) => {
      if (isTheme(globals.theme)) setTheme(globals.theme);
    };

    context.channel.on(GLOBALS_UPDATED, onGlobalsUpdated);
    return () => context.channel.off(GLOBALS_UPDATED, onGlobalsUpdated);
  }, [context.channel]);

  return (
    <ThemeProvider key={theme} defaultTheme={theme} storageKey={`shipfox-storybook-theme-${theme}`}>
      <DocsContainer context={context} theme={docsTheme}>
        {children}
      </DocsContainer>
    </ThemeProvider>
  );
}

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
    docs: {
      container: DesignSystemDocsContainer,
    },
    options: {
      storySort: {method: 'alphabetical'},
    },
  },
};

export default preview;
