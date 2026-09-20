import {ApiError} from '@shipfox/client-api';
import {render, screen} from '@testing-library/react';
import {InvitationAcceptanceErrorState} from './invitation-accept-page.js';

describe('InvitationAcceptanceErrorState', () => {
  test('renders a full-workspace state for a refused acceptance', () => {
    render(
      <InvitationAcceptanceErrorState
        error={
          new ApiError({
            message: 'Workspace membership cap exceeded',
            code: 'workspace-membership-cap-exceeded',
            status: 409,
          })
        }
        isPending={false}
        navigate={vi.fn()}
        onRetry={vi.fn()}
        inviterLine="Invited to join as guest@example.com."
        workspaceName="Acme"
      />,
    );

    expect(screen.getByRole('heading', {name: 'Workspace is full'})).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Acme has reached its membership limit. Ask an administrator to free a seat before trying again.',
    );
    expect(screen.getByRole('button', {name: 'Go to dashboard'})).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Try again'})).not.toBeInTheDocument();
  });
});
