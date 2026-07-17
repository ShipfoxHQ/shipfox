import {getLoadedConfig} from '@shipfox/client-config';
import {QueryClient, useQueryClient} from '@tanstack/react-query';
import {render, screen} from '@testing-library/react';
import {createStore, useStore} from 'jotai';
import {createShellDecorator, ShellProviders} from './index.js';

describe('shell testing helpers', () => {
  test('uses caller-owned state and installs runtime config', () => {
    const queryClient = new QueryClient();
    const store = createStore();
    const config = {apiUrl: 'https://example.test'};
    const Probe = () => {
      const receivedQueryClient = useQueryClient();
      const receivedStore = useStore();
      return (
        <div>
          {receivedQueryClient === queryClient && receivedStore === store
            ? 'caller state'
            : 'default state'}
        </div>
      );
    };

    render(
      <ShellProviders queryClient={queryClient} store={store} config={config}>
        <Probe />
      </ShellProviders>,
    );

    expect(screen.getByText('caller state')).toBeInTheDocument();
    expect(getLoadedConfig()).toEqual(config);
  });

  test('creates a configured Storybook decorator', () => {
    const DecoratedStory = createShellDecorator({config: {mode: 'storybook'}})(
      () => <div>Story content</div>,
      {} as never,
    );

    render(DecoratedStory);

    expect(screen.getByText('Story content')).toBeInTheDocument();
    expect(getLoadedConfig()).toEqual({mode: 'storybook'});
  });
});
