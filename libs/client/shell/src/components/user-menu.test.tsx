import {DropdownMenuItem} from '@shipfox/react-ui/dropdown-menu';
import {fireEvent, screen} from '@testing-library/react';
import {defineClientFeature} from '#contract.js';
import {useAuthState} from '#runtime/auth.js';
import type {ChromeSlots} from '#runtime/chrome-context.js';
import {defineRoute} from '#runtime/define-route.js';
import {renderComposedShell} from '#test/render.js';

function accountMenuFeature() {
  return defineClientFeature({
    id: 'acme.account-menu',
    routes: [
      {path: '/w/$workspaceSlug/account-menu', parent: 'workspaceLayout', impl: 'account-menu'},
    ],
  });
}

function PrivateAccountMenuEntry() {
  const {isAuthenticated} = useAuthState();
  if (!isAuthenticated) return null;
  return <DropdownMenuItem>Private entry</DropdownMenuItem>;
}

function dockModule() {
  return Promise.resolve({default: () => null});
}

async function openAccountMenu(chrome: Partial<ChromeSlots> = {}, dock = false) {
  await renderComposedShell({
    features: [
      accountMenuFeature(),
      ...(dock ? [{id: 'acme.dock', projectDock: {load: dockModule}}] : []),
    ],
    initialPath: '/w/workspace/account-menu',
    resolveImpl: () =>
      defineRoute({staticData: {frame: 'content'}, component: () => <h1>Account menu</h1>}),
    chrome,
  });
  fireEvent.pointerDown(await screen.findByRole('button', {name: 'User menu'}));
}

describe('UserMenu', () => {
  test('keeps shell-owned controls when no account-menu entry is provided', async () => {
    await openAccountMenu();

    expect(await screen.findByText('Theme')).toBeVisible();
    expect(screen.getByRole('menuitem', {name: 'Logout'})).toBeVisible();
    expect(screen.queryByRole('menuitem', {name: 'Private entry'})).not.toBeInTheDocument();
  });

  test('hides the Shippy control when no feature contributes a dock', async () => {
    await openAccountMenu();

    expect(await screen.findByText('Theme')).toBeVisible();
    expect(screen.queryByText('Shippy')).not.toBeInTheDocument();
  });

  test('stores the Shippy placement and keeps the menu open', async () => {
    window.localStorage.clear();
    await openAccountMenu({}, true);
    const tabBar = await screen.findByRole('menuitemradio', {name: 'Tab bar'});
    expect(screen.getByRole('menuitemradio', {name: 'Floating'})).toHaveAttribute(
      'aria-checked',
      'true',
    );

    fireEvent.click(tabBar);

    expect(tabBar).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menu')).toBeVisible();
    expect(window.localStorage.getItem('shipfox.shippy.placement')).toBe('tab_bar');
    window.localStorage.clear();
  });

  test('switches the theme from the segmented control and keeps the menu open', async () => {
    await openAccountMenu();
    const light = await screen.findByRole('menuitemradio', {name: 'Light'});

    fireEvent.click(light);

    expect(light).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menu')).toBeVisible();
  });

  test('renders a composing account-menu entry without replacing shell controls', async () => {
    await openAccountMenu({AccountMenuEntry: PrivateAccountMenuEntry});

    expect(await screen.findByRole('menuitem', {name: 'Private entry'})).toBeVisible();
    expect(screen.getByText('Theme')).toBeVisible();
    expect(screen.getByRole('menuitem', {name: 'Logout'})).toBeVisible();
  });

  test('contains a failing account-menu entry without unmounting the shell', async () => {
    const failure = new Error('Account menu failed');
    const reportErrorSpy = vi.fn();
    vi.stubGlobal('reportError', reportErrorSpy);
    const FailingAccountMenuEntry = () => {
      throw failure;
    };

    try {
      await openAccountMenu({AccountMenuEntry: FailingAccountMenuEntry});

      expect(await screen.findByText('Theme')).toBeVisible();
      expect(screen.getByRole('menuitem', {name: 'Logout'})).toBeVisible();
      expect(reportErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          cause: failure,
          message: 'Failed to render account menu entry.',
        }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
