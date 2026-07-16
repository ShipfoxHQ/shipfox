import {createMemoryHistory, RouterProvider} from '@tanstack/react-router';
import {render, screen} from '@testing-library/react';
import {router} from '#test/typecheck/shipfox-app.gen.js';

describe('generated composition router', () => {
  test('renders added and overridden routes', async () => {
    router.update({
      history: createMemoryHistory({initialEntries: ['/workspaces/workspace/insights']}),
    });

    render(<RouterProvider router={router} />);

    expect(await screen.findByText('Named route')).toBeVisible();

    await router.navigate({
      to: '/workspaces/$wid/projects/$pid/overview',
      params: {wid: 'workspace', pid: 'project'},
      search: {tab: 'overview'},
    });

    expect(await screen.findByText('Search route')).toBeVisible();
  });
});
