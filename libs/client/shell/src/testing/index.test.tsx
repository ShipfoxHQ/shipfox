import {ApiError} from '@shipfox/client-api';
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

  test('applies the adopted-session gate policy to the default client', () => {
    let retry: ((failureCount: number, error: Error) => boolean) | undefined;
    let throwOnError: ((error: Error, query: never) => boolean) | undefined;

    const Probe = () => {
      const client = useQueryClient();
      const defaults = client.getDefaultOptions().queries;
      retry = typeof defaults?.retry === 'function' ? defaults.retry : undefined;
      throwOnError =
        typeof defaults?.throwOnError === 'function' ? defaults.throwOnError : undefined;
      return null;
    };

    render(
      <ShellProviders>
        <Probe />
      </ShellProviders>,
    );

    const error = new ApiError({
      message: 'Renewal is paused.',
      code: 'adopted-session-paused',
      status: 0,
    });
    expect(retry?.(0, error)).toBe(false);
    expect(throwOnError?.(error, {} as never)).toBe(false);
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

  test('does not refresh auth when rendering static testing providers', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    render(
      <ShellProviders>
        <div>Static content</div>
      </ShellProviders>,
    );

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
