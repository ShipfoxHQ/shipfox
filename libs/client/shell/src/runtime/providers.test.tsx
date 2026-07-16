import {QueryClient, useQueryClient} from '@tanstack/react-query';
import {render} from '@testing-library/react';
import {createStore, useStore} from 'jotai';
import type {PropsWithChildren} from 'react';
import {defineClientFeature} from '#contract.js';
import {ShellProviderStack} from './provider-stack.js';

describe('ShellProviderStack', () => {
  test('gives providers the shell query client and store in feature declaration order', () => {
    const queryClient = new QueryClient();
    const store = createStore();
    const breadcrumbs: string[] = [];
    const received: Array<{queryClient: QueryClient; store: ReturnType<typeof createStore>}> = [];
    const Probe = ({id, children}: PropsWithChildren<{id: string}>) => {
      received.push({queryClient: useQueryClient(), store: useStore()});
      breadcrumbs.push(id);
      return <>{children}</>;
    };
    const features = [
      defineClientFeature({
        id: 'shipfox.first',
        providers: [{id: 'first', Component: ({children}) => <Probe id="first">{children}</Probe>}],
      }),
      defineClientFeature({
        id: 'acme.second',
        providers: [
          {id: 'second', Component: ({children}) => <Probe id="second">{children}</Probe>},
          {id: 'third', Component: ({children}) => <Probe id="third">{children}</Probe>},
        ],
      }),
    ];

    render(
      <ShellProviderStack features={features} queryClient={queryClient} store={store}>
        <div>Content</div>
      </ShellProviderStack>,
    );

    expect(breadcrumbs).toEqual(['first', 'second', 'third']);
    expect(received).toEqual([
      {queryClient, store},
      {queryClient, store},
      {queryClient, store},
    ]);
  });
});
