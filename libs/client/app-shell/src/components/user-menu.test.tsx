import {ThemeProvider} from '@shipfox/react-ui';
import {fireEvent, render, screen} from '@testing-library/react';
import type {ComponentProps, ReactNode} from 'react';
import {UserMenu} from './user-menu.js';

vi.mock('@shipfox/client-auth', () => ({
  useAuthState: () => ({
    user: {email: 'engineer@shipfox.io'},
  }),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    ...props
  }: {
    children: ReactNode;
    to: string;
  } & ComponentProps<'a'>) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

describe('UserMenu', () => {
  test('opens the avatar menu and renders the logout link', async () => {
    render(
      <ThemeProvider>
        <UserMenu />
      </ThemeProvider>,
    );

    fireEvent.pointerDown(screen.getByRole('button', {name: 'User menu'}), {
      button: 0,
      ctrlKey: false,
    });

    expect(await screen.findByRole('menuitem', {name: 'Logout'})).toHaveAttribute(
      'href',
      '/auth/logout',
    );
  });
});
