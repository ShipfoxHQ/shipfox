import type {AnyRouter} from '@tanstack/react-router';
import {cleanup, fireEvent, screen, waitFor, within} from '@testing-library/react';
import {useEffect, useRef} from 'react';
import {type ClientFeature, defineClientFeature, type ProjectDockContribution} from '#contract.js';
import type {AuthStateValue} from '#runtime/auth.js';
import {defineRoute} from '#runtime/define-route.js';
import {useProjectDock} from '#runtime/project-dock.js';
import {type ShippyState, useShippyStatus} from '#runtime/shippy-status.js';
import {renderComposedShell} from '#test/render.js';
import {ProjectDockPanel} from './project-dock-panel.js';

const LAUNCHER_NAME = 'Open Shippy, your project agent';
const UNREAD_COUNT = /^\d+$/;

const dockMounted = vi.fn();
const dockUnmounted = vi.fn();

function Dock() {
  const {setOpen} = useProjectDock();
  useEffect(() => {
    dockMounted();
    return () => dockUnmounted();
  }, []);
  return (
    <ProjectDockPanel label="Shippy">
      <p>Dock body</p>
      <button type="button" onClick={() => setOpen(false)}>
        Close dock
      </button>
    </ProjectDockPanel>
  );
}

function dockFeature(load: ProjectDockContribution['load'] = async () => ({default: Dock})) {
  return defineClientFeature({id: 'acme.dock', projectDock: {load}});
}

function pagesFeature() {
  return defineClientFeature({
    id: 'acme.pages',
    routes: [
      {path: '/w/$workspaceSlug/overview', parent: 'workspaceLayout', impl: 'overview'},
      {path: '/w/$workspaceSlug/p/$projectSlug/runs', parent: 'projectLayout', impl: 'runs'},
      {path: '/w/$workspaceSlug/p/$projectSlug/logs', parent: 'projectLayout', impl: 'logs'},
      {path: '/w/$workspaceSlug/p/$projectSlug/connect', parent: 'projectLayout', impl: 'connect'},
    ],
    navigation: [
      {id: 'runs', scope: 'project', label: 'Runs', to: '/w/$workspaceSlug/p/$projectSlug/runs'},
      {id: 'logs', scope: 'project', label: 'Logs', to: '/w/$workspaceSlug/p/$projectSlug/logs'},
    ],
  });
}

function renderDock({
  initialPath = '/w/workspace/p/project/runs',
  features = [pagesFeature(), dockFeature()],
  hideProjectNavigation = false,
  auth,
}: {
  initialPath?: string;
  features?: readonly ClientFeature[];
  hideProjectNavigation?: boolean;
  auth?: AuthStateValue;
} = {}) {
  return renderComposedShell({
    ...(auth ? {auth} : {}),
    features,
    initialPath,
    resolveImpl: (specifier) =>
      defineRoute({
        staticData: {frame: specifier === 'connect' ? 'focused' : 'data'},
        component: () => <h1>{specifier}</h1>,
      }),
    workspaceSetup: async () => ({hideProjectNavigation}),
  });
}

function frameOf(main: HTMLElement): HTMLElement {
  return main.firstElementChild as HTMLElement;
}

async function openFromLauncher() {
  await waitFor(() => expect(dockMounted).toHaveBeenCalled());
  fireEvent.click(await screen.findByRole('button', {name: LAUNCHER_NAME}));
}

/** `sprite` for floating Shippy, or the pose of the still image in the tab bar. */
async function launcherForm() {
  const launcher = await screen.findByRole('button', {name: LAUNCHER_NAME, hidden: true});
  if (launcher.querySelector('[data-slot="shippy-sprite"]')) return 'sprite';
  return launcher.querySelector('img')?.getAttribute('data-pose');
}

async function spriteState() {
  const launcher = await screen.findByRole('button', {name: LAUNCHER_NAME});
  return launcher.querySelector('[data-slot="shippy-sprite"]')?.getAttribute('data-state');
}

function publishingDock(state: ShippyState, unread = 0) {
  return dockFeature(async () => ({
    default: function PublishingDock() {
      useShippyStatus({state, unread});
      return <Dock />;
    },
  }));
}

function greetedAlready() {
  window.localStorage.setItem('shipfox.shippy.greeted', 'true');
}

async function chooseInUserMenu(option: string) {
  fireEvent.pointerDown(await screen.findByRole('button', {name: 'User menu'}));
  fireEvent.click(await screen.findByRole('menuitemradio', {name: option}));
}

function useNarrowViewport() {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query) =>
      ({
        matches: false,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  dockMounted.mockClear();
  dockUnmounted.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('project dock', () => {
  test('changes nothing when no feature contributes a dock', async () => {
    await renderDock({features: [pagesFeature()]});

    const main = await screen.findByRole('main');
    expect(screen.queryByRole('button', {name: LAUNCHER_NAME})).not.toBeInTheDocument();
    expect(frameOf(main).style.paddingBottom).toBe('');
    expect(main).toHaveStyle('--app-content-h: calc(100dvh - 96px)');
  });

  test('keeps the floating strip clear while the panel is closed', async () => {
    await renderDock();

    const main = await screen.findByRole('main');
    expect(await screen.findByRole('button', {name: LAUNCHER_NAME})).toBeVisible();
    expect(frameOf(main).style.paddingBottom).toBe('calc(var(--pad-frame-y) - 16px)');
    expect(main.style.marginBottom).toBe('72px');
    expect(main).toHaveStyle('--app-content-h: calc(100dvh - 168px)');
  });

  test('opens beside the page, gives the strip back, and returns focus on close', async () => {
    await renderDock();
    await openFromLauncher();

    const panel = await screen.findByRole('complementary', {name: 'Shippy'});
    expect(panel).toHaveTextContent('Dock body');
    expect(panel).toHaveFocus();
    expect(panel.closest('main')).toBeNull();
    expect(screen.queryByRole('button', {name: LAUNCHER_NAME})).not.toBeInTheDocument();
    const main = screen.getByRole('main');
    expect(frameOf(main).style.paddingBottom).toBe('');
    expect(main.style.marginBottom).toBe('');
    expect(main).toHaveStyle('--app-content-h: calc(100dvh - 96px)');
    expect(window.localStorage.getItem('shipfox.projectDock.open')).toBe('true');

    fireEvent.click(within(panel).getByRole('button', {name: 'Close dock'}));

    await waitFor(() => expect(screen.getByRole('button', {name: LAUNCHER_NAME})).toHaveFocus());
    expect(window.localStorage.getItem('shipfox.projectDock.open')).toBe('false');
  });

  test('marks the launcher as collapsed', async () => {
    await renderDock();

    expect(await screen.findByRole('button', {name: LAUNCHER_NAME})).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  test('leaves focus in the panel when the dock already moved it there', async () => {
    function FocusingDock() {
      const {open} = useProjectDock();
      const composerRef = useRef<HTMLTextAreaElement | null>(null);
      useEffect(() => {
        if (open) composerRef.current?.focus();
      }, [open]);
      dockMounted();
      return (
        <ProjectDockPanel label="Shippy">
          <textarea ref={composerRef} aria-label="Composer" />
        </ProjectDockPanel>
      );
    }
    await renderDock({
      features: [pagesFeature(), dockFeature(async () => ({default: FocusingDock}))],
    });
    await openFromLauncher();

    expect(await screen.findByRole('textbox', {name: 'Composer'})).toHaveFocus();
  });

  test('moves focus into a panel that mounts after the click', async () => {
    let resolveDock: (module: {default: typeof Dock}) => void = () => undefined;
    const load = () =>
      new Promise<{default: typeof Dock}>((resolve) => {
        resolveDock = resolve;
      });
    await renderDock({features: [pagesFeature(), dockFeature(load)]});
    fireEvent.click(await screen.findByRole('button', {name: LAUNCHER_NAME}));

    resolveDock({default: Dock});

    expect(await screen.findByRole('complementary', {name: 'Shippy'})).toHaveFocus();
  });

  test('leaves focus on a control the user is already on', async () => {
    await renderDock();
    await waitFor(() => expect(dockMounted).toHaveBeenCalled());
    const userMenu = await screen.findByRole('button', {name: 'User menu'});
    userMenu.focus();

    fireEvent.click(await screen.findByRole('button', {name: LAUNCHER_NAME}));

    expect(await screen.findByRole('complementary', {name: 'Shippy'})).toBeVisible();
    expect(userMenu).toHaveFocus();
  });

  test('restores the open panel for this browser', async () => {
    window.localStorage.setItem('shipfox.projectDock.open', 'true');

    await renderDock();

    const panel = await screen.findByRole('complementary', {name: 'Shippy'});
    expect(panel).toBeVisible();
    expect(panel).toHaveFocus();
  });

  test('keeps one dock instance across project pages', async () => {
    const {router} = await renderDock();
    await screen.findByRole('heading', {name: 'runs'});

    await (router as AnyRouter).navigate({to: '/w/workspace/p/project/logs' as never});

    expect(await screen.findByRole('heading', {name: 'logs'})).toBeVisible();
    await waitFor(() => expect(dockMounted).toHaveBeenCalledTimes(1));
    expect(dockUnmounted).not.toHaveBeenCalled();
  });

  test('remounts the dock when the project changes', async () => {
    const {router} = await renderDock();
    await waitFor(() => expect(dockMounted).toHaveBeenCalledTimes(1));

    await (router as AnyRouter).navigate({to: '/w/workspace/p/other/runs' as never});

    await waitFor(() => expect(dockMounted).toHaveBeenCalledTimes(2));
    expect(dockUnmounted).toHaveBeenCalledTimes(1);
  });

  test('remounts the dock between same-slug projects of two workspaces', async () => {
    const {router} = await renderDock({
      auth: {
        status: 'authenticated',
        workspaces: [
          {id: 'workspace', name: 'Workspace', slug: 'workspace', membershipId: 'membership'},
          {id: 'other', name: 'Other', slug: 'other', membershipId: 'other-membership'},
        ],
        isLoading: false,
        isAuthenticated: true,
        hasWorkspace: true,
      },
    });
    await waitFor(() => expect(dockMounted).toHaveBeenCalledTimes(1));

    await (router as AnyRouter).navigate({to: '/w/other/p/project/runs' as never});

    await waitFor(() => expect(dockMounted).toHaveBeenCalledTimes(2));
    expect(dockUnmounted).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['a workspace page', '/w/workspace/overview', false, 'overview'],
    ['a focused frame', '/w/workspace/p/project/connect', false, 'connect'],
  ])('stays off %s', async (_, initialPath, hideProjectNavigation, heading) => {
    window.localStorage.setItem('shipfox.projectDock.open', 'true');

    await renderDock({initialPath, hideProjectNavigation});

    expect(await screen.findByRole('heading', {name: heading})).toBeVisible();
    expect(screen.queryByRole('button', {name: LAUNCHER_NAME})).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary', {name: 'Shippy'})).not.toBeInTheDocument();
    expect(dockMounted).not.toHaveBeenCalled();
  });

  test('stays off the pre-project gate', async () => {
    await renderDock({hideProjectNavigation: true});

    expect(await screen.findByRole('heading', {name: 'runs'})).toBeVisible();
    expect(screen.queryByRole('button', {name: LAUNCHER_NAME})).not.toBeInTheDocument();
  });

  test('moves to the tab bar from the user menu and gives the strip back', async () => {
    await renderDock();
    const main = await screen.findByRole('main');
    expect(await launcherForm()).toBe('sprite');

    await chooseInUserMenu('Tab bar');

    expect(await launcherForm()).toBe('face');
    const launcher = screen.getByRole('button', {name: LAUNCHER_NAME, hidden: true});
    expect(screen.getByRole('tablist', {hidden: true}).contains(launcher)).toBe(false);
    expect(frameOf(main).style.paddingBottom).toBe('');
    expect(window.localStorage.getItem('shipfox.shippy.placement')).toBe('tab_bar');
  });

  test('moves back to floating and takes the strip again', async () => {
    window.localStorage.setItem('shipfox.shippy.placement', 'tab_bar');
    await renderDock();
    const main = await screen.findByRole('main');
    expect(frameOf(main).style.paddingBottom).toBe('');

    await chooseInUserMenu('Floating');

    expect(await launcherForm()).toBe('sprite');
    expect(frameOf(main).style.paddingBottom).toBe('calc(var(--pad-frame-y) - 16px)');
  });

  test('ignores an unknown stored placement', async () => {
    window.localStorage.setItem('shipfox.shippy.placement', 'sideways');

    await renderDock();

    expect(await launcherForm()).toBe('sprite');
  });

  test('uses the tab bar and a modal sheet below 976px', async () => {
    useNarrowViewport();
    await renderDock();
    const main = await screen.findByRole('main');

    fireEvent.pointerDown(await screen.findByRole('button', {name: 'User menu'}));
    expect(await screen.findByText('Theme')).toBeVisible();
    expect(screen.queryByText('Shippy')).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('menu'), {key: 'Escape'});

    expect(await launcherForm()).toBe('face');
    expect(frameOf(main).style.paddingBottom).toBe('');

    await openFromLauncher();

    const sheet = await screen.findByRole('dialog', {name: 'Shippy'});
    expect(sheet).toHaveTextContent('Dock body');
    expect(screen.queryByRole('complementary', {name: 'Shippy'})).not.toBeInTheDocument();
  });

  test('does not restore the open flag as a modal sheet below 976px', async () => {
    useNarrowViewport();
    window.localStorage.setItem('shipfox.projectDock.open', 'true');

    await renderDock();

    expect(await screen.findByRole('button', {name: LAUNCHER_NAME})).toBeVisible();
    await waitFor(() => expect(dockMounted).toHaveBeenCalled());
    expect(screen.queryByRole('dialog', {name: 'Shippy'})).not.toBeInTheDocument();
  });

  describe('when the dock fails', () => {
    const failure = new Error('Dock failed');
    const reportErrorSpy = vi.fn();

    beforeEach(() => {
      reportErrorSpy.mockClear();
      vi.stubGlobal('reportError', reportErrorSpy);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    test('keeps the page, drops the launcher and strip, and clears the open flag', async () => {
      window.localStorage.setItem('shipfox.projectDock.open', 'true');
      const FailingDock = () => {
        throw failure;
      };

      await renderDock({
        features: [pagesFeature(), dockFeature(async () => ({default: FailingDock}))],
      });

      expect(await screen.findByRole('heading', {name: 'runs'})).toBeVisible();
      await waitFor(() =>
        expect(reportErrorSpy).toHaveBeenCalledWith(
          expect.objectContaining({cause: failure, message: 'Failed to render the project dock.'}),
        ),
      );
      await waitFor(() =>
        expect(screen.queryByRole('button', {name: LAUNCHER_NAME})).not.toBeInTheDocument(),
      );
      expect(frameOf(screen.getByRole('main')).style.paddingBottom).toBe('');
      expect(window.localStorage.getItem('shipfox.projectDock.open')).toBe('false');
    });

    test('loads the dock again on the next navigation after a failed chunk', async () => {
      const load = vi
        .fn<ProjectDockContribution['load']>()
        .mockRejectedValueOnce(failure)
        .mockResolvedValue({default: Dock});
      const {router} = await renderDock({features: [pagesFeature(), dockFeature(load)]});
      await waitFor(() => expect(reportErrorSpy).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(screen.queryByRole('button', {name: LAUNCHER_NAME})).not.toBeInTheDocument(),
      );

      await (router as AnyRouter).navigate({to: '/w/workspace/p/project/logs' as never});

      expect(await screen.findByRole('button', {name: LAUNCHER_NAME})).toBeVisible();
      await waitFor(() => expect(dockMounted).toHaveBeenCalledTimes(1));
      expect(load).toHaveBeenCalledTimes(2);
    });

    test('brings the launcher back when a failed project is revisited', async () => {
      const load = vi
        .fn<ProjectDockContribution['load']>()
        .mockRejectedValueOnce(failure)
        .mockResolvedValue({default: Dock});
      const {router} = await renderDock({features: [pagesFeature(), dockFeature(load)]});
      await waitFor(() => expect(reportErrorSpy).toHaveBeenCalledTimes(1));

      await (router as AnyRouter).navigate({to: '/w/workspace/p/other/runs' as never});
      await waitFor(() => expect(dockMounted).toHaveBeenCalledTimes(1));
      await (router as AnyRouter).navigate({to: '/w/workspace/p/project/runs' as never});

      await waitFor(() => expect(dockMounted).toHaveBeenCalledTimes(2));
      expect(await screen.findByRole('button', {name: LAUNCHER_NAME})).toBeVisible();
    });

    test('keeps the attempt budget across visits to other projects', async () => {
      const load = vi
        .fn<ProjectDockContribution['load']>()
        .mockRejectedValueOnce(failure)
        .mockRejectedValueOnce(failure)
        .mockRejectedValueOnce(failure)
        .mockResolvedValue({default: Dock});
      const {router} = await renderDock({features: [pagesFeature(), dockFeature(load)]});
      const visit = (page: string) =>
        (router as AnyRouter).navigate({to: `/w/workspace/p/${page}` as never});

      await waitFor(() => expect(reportErrorSpy).toHaveBeenCalledTimes(1));
      await visit('project/logs');
      await waitFor(() => expect(reportErrorSpy).toHaveBeenCalledTimes(2));
      await visit('project/runs');
      await waitFor(() => expect(reportErrorSpy).toHaveBeenCalledTimes(3));
      await visit('other/runs');
      await waitFor(() => expect(dockMounted).toHaveBeenCalledTimes(1));
      await visit('project/logs');

      expect(await screen.findByRole('heading', {name: 'logs'})).toBeVisible();
      await waitFor(() => expect(dockUnmounted).toHaveBeenCalledTimes(1));
      expect(dockMounted).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('button', {name: LAUNCHER_NAME})).not.toBeInTheDocument();
    });

    test('stops retrying a dock that keeps failing', async () => {
      const load = vi.fn<ProjectDockContribution['load']>().mockRejectedValue(failure);
      const {router} = await renderDock({features: [pagesFeature(), dockFeature(load)]});
      const visit = (page: string) =>
        (router as AnyRouter).navigate({to: `/w/workspace/p/project/${page}` as never});

      await waitFor(() => expect(reportErrorSpy).toHaveBeenCalledTimes(1));
      await visit('logs');
      await waitFor(() => expect(reportErrorSpy).toHaveBeenCalledTimes(2));
      await visit('runs');
      await waitFor(() => expect(reportErrorSpy).toHaveBeenCalledTimes(3));
      await visit('logs');
      await visit('runs');

      expect(await screen.findByRole('heading', {name: 'runs'})).toBeVisible();
      expect(load).toHaveBeenCalledTimes(3);
      expect(reportErrorSpy).toHaveBeenCalledTimes(3);
      expect(screen.queryByRole('button', {name: LAUNCHER_NAME})).not.toBeInTheDocument();
    });
  });

  test('does not hold the page for a dock that is still loading', async () => {
    await renderDock({
      features: [pagesFeature(), dockFeature(() => new Promise(() => undefined))],
    });

    expect(await screen.findByRole('heading', {name: 'runs'})).toBeVisible();
    expect(dockMounted).not.toHaveBeenCalled();
  });
});

describe("Shippy's motion", () => {
  beforeEach(greetedAlready);

  test('animates from the state the dock publishes', async () => {
    await renderDock({features: [pagesFeature(), publishingDock('working')]});

    await waitFor(async () => expect(await spriteState()).toBe('working'));
  });

  test('stays idle while the dock publishes nothing', async () => {
    await renderDock();

    expect(await spriteState()).toBe('idle');
  });

  test('stays still after a failure', async () => {
    await renderDock({features: [pagesFeature(), publishingDock('failed')]});

    await waitFor(async () => expect(await spriteState()).toBe('failed'));
  });

  test('keeps the discreet face still', async () => {
    window.localStorage.setItem('shipfox.shippy.placement', 'tab_bar');

    await renderDock({features: [pagesFeature(), publishingDock('working')]});

    expect(await launcherForm()).toBe('face');
    expect(document.querySelector('[data-slot="shippy-sprite"]')).not.toBeInTheDocument();
  });
});

describe("Shippy's unread badge", () => {
  beforeEach(greetedAlready);

  test('names the unread count on floating Shippy and shows it beside the hoodie', async () => {
    await renderDock({features: [pagesFeature(), publishingDock('reply_ready', 2)]});

    const launcher = await screen.findByRole('button', {name: 'Shippy, 2 unread'});
    expect(within(launcher).getByText('2')).toBeVisible();
    expect(launcher.querySelector('[data-slot="shippy-sprite"]')).toHaveAttribute(
      'data-state',
      'reply_ready',
    );
  });

  test('shows the count on the discreet face', async () => {
    window.localStorage.setItem('shipfox.shippy.placement', 'tab_bar');

    await renderDock({features: [pagesFeature(), publishingDock('idle', 1)]});

    const launcher = await screen.findByRole('button', {name: 'Shippy, 1 unread'});
    expect(within(launcher).getByText('1')).toBeVisible();
  });

  test('shows no badge while nothing is unread', async () => {
    await renderDock({features: [pagesFeature(), publishingDock('idle')]});

    const launcher = await screen.findByRole('button', {name: LAUNCHER_NAME});
    expect(within(launcher).queryByText(UNREAD_COUNT)).not.toBeInTheDocument();
  });
});

describe('first-run greeting', () => {
  const greeting = () => screen.queryByRole('region', {name: "Hi, I'm Shippy."});

  test('greets once beside floating Shippy, with a wave', async () => {
    await renderDock();

    expect(await screen.findByRole('region', {name: "Hi, I'm Shippy."})).toBeVisible();
    expect(await spriteState()).toBe('greeting');
  });

  test('never returns once dismissed', async () => {
    await renderDock();

    fireEvent.click(await screen.findByRole('button', {name: 'Not now'}));

    expect(greeting()).not.toBeInTheDocument();
    expect(await spriteState()).toBe('idle');
    expect(window.localStorage.getItem('shipfox.shippy.greeted')).toBe('true');
    cleanup();

    await renderDock();
    expect(await screen.findByRole('button', {name: LAUNCHER_NAME})).toBeVisible();
    expect(greeting()).not.toBeInTheDocument();
  });

  test('opens the panel from Say hello', async () => {
    await renderDock();
    await waitFor(() => expect(dockMounted).toHaveBeenCalled());

    fireEvent.click(await screen.findByRole('button', {name: 'Say hello'}));

    expect(await screen.findByRole('complementary', {name: 'Shippy'})).toBeVisible();
    fireEvent.click(screen.getByRole('button', {name: 'Close dock'}));
    expect(await screen.findByRole('button', {name: LAUNCHER_NAME})).toBeVisible();
    expect(greeting()).not.toBeInTheDocument();
  });

  test('counts a panel that opens by itself as the first meeting', async () => {
    window.localStorage.setItem('shipfox.projectDock.open', 'true');
    await renderDock();

    fireEvent.click(await screen.findByRole('button', {name: 'Close dock'}));

    expect(await screen.findByRole('button', {name: LAUNCHER_NAME})).toBeVisible();
    expect(greeting()).not.toBeInTheDocument();
    expect(window.localStorage.getItem('shipfox.shippy.greeted')).toBe('true');
  });

  test('never greets from the tab bar', async () => {
    window.localStorage.setItem('shipfox.shippy.placement', 'tab_bar');

    await renderDock();

    expect(await screen.findByRole('button', {name: LAUNCHER_NAME})).toBeVisible();
    expect(greeting()).not.toBeInTheDocument();
    expect(window.localStorage.getItem('shipfox.shippy.greeted')).toBeNull();
  });
});
