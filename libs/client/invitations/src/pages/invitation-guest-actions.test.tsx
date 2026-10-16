import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import {render, screen} from '@testing-library/react';
import {InvitationGuestActions} from './invitation-accept-page.js';

const INVITATION_REDIRECT = encodeURIComponent('/invitations/accept?token=invite-token');

function renderActions(passwordLogin: boolean) {
  const rootRoute = createRootRoute({
    component: () => <InvitationGuestActions token="invite-token" passwordLogin={passwordLogin} />,
  });
  const router = createRouter({
    history: createMemoryHistory({initialEntries: ['/']}),
    routeTree: rootRoute,
  });
  render(<RouterProvider router={router} />);
}

describe('InvitationGuestActions', () => {
  test('offers signup and login when the server offers password login', async () => {
    renderActions(true);

    expect(await screen.findByRole('link', {name: 'Create account'})).toHaveAttribute(
      'href',
      `/auth/signup?redirect=${INVITATION_REDIRECT}`,
    );
    expect(screen.getByRole('link', {name: 'I already have an account'})).toHaveAttribute(
      'href',
      `/auth/login?redirect=${INVITATION_REDIRECT}`,
    );
  });

  test('offers one login entry point without password login', async () => {
    renderActions(false);

    expect(await screen.findByRole('link', {name: 'Continue'})).toHaveAttribute(
      'href',
      `/auth/login?redirect=${INVITATION_REDIRECT}`,
    );
    expect(screen.queryByRole('link', {name: 'Create account'})).not.toBeInTheDocument();
  });
});
