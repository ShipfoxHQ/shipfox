import {configureApiClient} from '@shipfox/client-api';
import {authStateAtom} from '@shipfox/client-shell/runtime';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import {cleanup, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {createStore, Provider as JotaiProvider} from 'jotai';
import {secretsListResponse, variablesListResponse} from '#test/fixtures/secrets.js';
import secretsSettingsRoute from './secrets-settings.js';
import variablesSettingsRoute from './variables-settings.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

const cases = [
  {
    name: 'secrets',
    route: secretsSettingsRoute,
    dialogName: 'Create secret',
    nameInput: 'secret-key',
    list: () => secretsListResponse({secrets: []}),
  },
  {
    name: 'variables',
    route: variablesSettingsRoute,
    dialogName: 'Create variable',
    nameInput: 'variable-key',
    list: () => variablesListResponse({variables: []}),
  },
] as const;

function renderRoute({
  route,
  list,
  search,
  name,
}: {
  route: (typeof cases)[number]['route'];
  list: () => unknown;
  search: string;
  name: string;
}) {
  const fetchImpl = vi.fn(
    async () =>
      new Response(JSON.stringify(list()), {
        status: 200,
        headers: {'content-type': 'application/json'},
      }),
  ) as unknown as typeof fetch;
  configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
  const rootRoute = createRootRoute({component: Outlet});
  const settings = createRoute({
    getParentRoute: () => rootRoute,
    path: `/w/$workspaceSlug/settings/${name}`,
    ...route.options,
  });
  const router = createRouter({
    history: createMemoryHistory({
      initialEntries: [`/w/acme/settings/${name}${search}`],
    }),
    routeTree: rootRoute.addChildren([settings]),
  });
  const store = createStore();
  store.set(authStateAtom, {
    status: 'authenticated',
    token: 'token',
    workspaces: [{id: WORKSPACE_ID, name: 'Acme', slug: 'acme', membershipId: 'membership-1'}],
  });

  render(
    <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
      <JotaiProvider store={store}>
        <RouterProvider router={router} />
      </JotaiProvider>
    </QueryClientProvider>,
  );

  return router;
}

afterEach(cleanup);

describe.each(cases)('$name settings route ?create=KEY', ({name, ...testCase}) => {
  test('opens the create modal with a valid key filled in', async () => {
    renderRoute({...testCase, name, search: '?create=MY_KEY'});

    expect(await screen.findByRole('dialog', {name: testCase.dialogName})).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('MY_KEY');
  });

  test('ignores a key that fails validation', async () => {
    renderRoute({...testCase, name, search: '?create=not-a-valid-key'});

    await screen.findByRole('region', {name: name === 'secrets' ? 'Secrets' : 'Variables'});
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('removes the parameter when the modal closes', async () => {
    const user = userEvent.setup();
    const router = renderRoute({...testCase, name, search: '?create=MY_KEY'});

    await screen.findByRole('dialog', {name: testCase.dialogName});
    await user.click(screen.getByRole('button', {name: 'Cancel'}));

    await waitFor(() => expect(router.state.location.search).toEqual({}));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
