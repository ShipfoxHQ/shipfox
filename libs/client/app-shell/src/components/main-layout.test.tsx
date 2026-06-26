// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {render, screen} from '@testing-library/react';
import type {ReactNode} from 'react';
import {MainLayout} from './main-layout.js';
import {NavBar} from './nav-bar.js';

vi.mock('@shipfox/client-auth', () => ({
  useActiveWorkspace: () => ({id: 'workspace-1', name: 'Acme Workspace'}),
  useMaybeActiveWorkspace: () => ({id: 'workspace-1', name: 'Acme Workspace'}),
  WorkspaceCrumb: ({workspace, compact}: {workspace: {name: string}; compact?: boolean}) => (
    <button type="button" aria-label="Switch workspace" data-compact={String(Boolean(compact))}>
      {workspace.name}
    </button>
  ),
}));

vi.mock('@shipfox/client-projects', () => ({
  ProjectCrumb: () => <button type="button">Project crumb</button>,
  useProjectQuery: () => ({data: {id: 'project-1', name: 'Platform'}}),
}));

vi.mock('@shipfox/react-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shipfox/react-ui')>();
  return {
    ...actual,
    Logo: ({variant = 'wordmark', className}: {variant?: string; className?: string}) => (
      <span data-testid={`logo:${variant}`} className={className} />
    ),
  };
});

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    className,
    to,
    ...props
  }: {
    children: ReactNode;
    className?: string;
    to?: string;
    [key: string]: unknown;
  }) => {
    const {activeOptions, activeProps, inactiveProps, params, ...anchorProps} = props;
    void activeOptions;
    void activeProps;
    void inactiveProps;
    void params;
    return (
      <a href={to ?? '#'} className={className} {...anchorProps}>
        {children}
      </a>
    );
  },
  Outlet: () => <div>Route content</div>,
  useMatches: () => [],
  useParams: () => ({wid: 'workspace-1'}),
}));

vi.mock('./user-menu.js', () => ({
  UserMenu: () => <button type="button">User menu</button>,
}));

describe('MainLayout setup navigation', () => {
  test('removes the project crumb and tab strip while keeping workspace and user controls', () => {
    render(<MainLayout hideProjectNavigation />);

    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByText('Project crumb')).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Switch workspace'})).toHaveAttribute(
      'data-compact',
      'true',
    );
    expect(screen.getByRole('button', {name: 'User menu'})).toBeInTheDocument();
    expect(screen.getByTestId('logo:mark')).toHaveClass('sm:hidden');
    expect(screen.getByTestId('logo:wordmark')).toHaveClass('hidden sm:block');
  });

  test('shows project navigation after setup is complete', () => {
    render(<MainLayout />);

    expect(screen.getByRole('tablist', {name: 'Workspace sections'})).toBeInTheDocument();
    expect(screen.getByText('Project crumb')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Switch workspace'})).toHaveAttribute(
      'data-compact',
      'false',
    );
  });
});

describe('NavBar setup navigation', () => {
  test('uses the compact setup logo treatment', () => {
    render(<NavBar hideProjectNavigation />);

    expect(screen.getByTestId('logo:mark')).toHaveClass('sm:hidden');
    expect(screen.getByTestId('logo:wordmark')).toHaveClass('hidden sm:block');
  });
});
