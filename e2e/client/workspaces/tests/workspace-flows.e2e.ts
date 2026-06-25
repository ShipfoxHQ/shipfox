import {randomUUID} from 'node:crypto';
import {argosScreenshot, type Page} from '@shipfox/playwright';
import {expect, test} from './test.js';

const ONBOARDING_URL_RE = /\/setup\/workspaces\/new\/?$/u;
const WORKSPACE_INTEGRATIONS_URL_RE = /\/workspaces\/[^/]+\/integrations\/?$/u;
const CREATE_WORKSPACE_LABEL_RE = /Create workspace/u;
const LAST_WORKSPACE_KEY = 'shipfox.lastWorkspaceId';
const DEBUG_REPOSITORY_RE = /debug-owner\/platform/u;

function workspaceUrlRe(wid: string): RegExp {
  return new RegExp(`/workspaces/${wid}(/|$)`, 'u');
}

async function readLastWorkspaceId(page: Page): Promise<string> {
  const raw = await page.evaluate((key) => window.localStorage.getItem(key), LAST_WORKSPACE_KEY);
  expect(raw, `localStorage[${LAST_WORKSPACE_KEY}]`).not.toBeNull();
  return JSON.parse(raw as string) as string;
}

async function expectSetupNavigationHidden(page: Page): Promise<void> {
  await expect(page.getByRole('tab', {name: 'Projects'})).toHaveCount(0);
  await expect(page.getByRole('tab', {name: 'Settings'})).toHaveCount(0);
  await expect(page.getByLabel('Switch project')).toHaveCount(0);
  await expect(page.getByLabel('Switch workspace')).toBeVisible();
}

async function completeWorkspaceSetup(page: Page, workspaceId: string): Promise<void> {
  await page.goto(`/workspaces/${workspaceId}/integrations/debug`);
  await expect(page.getByText('Debug source control connected.')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/workspaces/${workspaceId}/projects/new/?$`, 'u'));
  await expect(page.getByRole('radio', {name: DEBUG_REPOSITORY_RE})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Create project'})).toBeEnabled();
  await page.getByRole('button', {name: 'Create project'}).click();

  await expect(page.getByText('Project created.')).toBeVisible();
  await expect(page).toHaveURL(
    new RegExp(`/workspaces/${workspaceId}/projects/[^/]+/runs/?$`, 'u'),
  );
}

test('redirects a no-workspace user from / to onboarding', async ({page, auth}) => {
  const user = await auth.createUser();
  await auth.loginAs(page, user);

  await page.goto('/');

  await expect(page).toHaveURL(ONBOARDING_URL_RE);
  await expect(page.getByRole('heading', {name: 'Create your workspace'})).toBeVisible();
  await expect(page.getByLabel('Workspace name')).toBeVisible();
  await argosScreenshot(page, 'workspaces/onboarding-blank');
});

test('redirects a no-workspace user from a workspace deep-link to onboarding', async ({
  page,
  auth,
}) => {
  const user = await auth.createUser();
  await auth.loginAs(page, user);

  await page.goto(`/workspaces/${randomUUID()}`);

  await expect(page).toHaveURL(ONBOARDING_URL_RE);
  await expect(page.getByRole('heading', {name: 'Create your workspace'})).toBeVisible();
});

test('creates the first workspace via onboarding and persists lastWorkspaceId', async ({
  page,
  auth,
}) => {
  const user = await auth.createUser();
  await auth.loginAs(page, user);
  const workspaceName = 'E2E Onboarding Workspace';

  await page.goto('/');
  await expect(page).toHaveURL(ONBOARDING_URL_RE);
  await page.getByLabel('Workspace name').fill(workspaceName);
  await page.getByRole('button', {name: 'Create workspace'}).click();

  await expect(page).toHaveURL(WORKSPACE_INTEGRATIONS_URL_RE);
  await expect(page.getByRole('heading', {name: 'Connect source control'})).toBeVisible();
  await expectSetupNavigationHidden(page);
  const url = new URL(page.url());
  const wid = url.pathname.split('/')[2];
  expect(wid).toBeTruthy();
  expect(await readLastWorkspaceId(page)).toBe(wid);
  await argosScreenshot(page, 'workspaces/onboarding-complete');
});

test('switches between workspaces from the top nav', async ({page, auth, workspaces}) => {
  const user = await auth.createUser();
  const workspaceAName = 'Alpha Workspace';
  const workspaceBName = 'Beta Workspace';
  const wsA = await workspaces.create({userId: user.user.id, name: workspaceAName});
  const wsB = await workspaces.create({userId: user.user.id, name: workspaceBName});
  await auth.loginAs(page, user);

  await page.goto(`/workspaces/${wsA.id}`);
  await expect(page).toHaveURL(workspaceUrlRe(wsA.id));

  await page.getByLabel('Switch workspace').click();
  await argosScreenshot(page, 'workspaces/switcher-open');
  await page.getByRole('option', {name: workspaceBName}).click();

  await expect(page).toHaveURL(workspaceUrlRe(wsB.id));
  await expect(page.getByRole('link', {name: workspaceBName})).toBeVisible();
  expect(await readLastWorkspaceId(page)).toBe(wsB.id);
});

test('persists the active workspace across reload and via /', async ({page, auth, workspaces}) => {
  const user = await auth.createUser();
  const wsA = await workspaces.create({userId: user.user.id, name: 'Alpha Workspace'});
  const wsB = await workspaces.create({userId: user.user.id, name: 'Beta Workspace'});
  await auth.loginAs(page, user);

  await page.goto(`/workspaces/${wsB.id}/integrations`);
  await expect(page).toHaveURL(workspaceUrlRe(wsB.id));

  await page.reload();
  await expect(page).toHaveURL(workspaceUrlRe(wsB.id));

  await page.goto('/');
  await expect(page).toHaveURL(workspaceUrlRe(wsB.id));
  expect(page.url()).not.toMatch(workspaceUrlRe(wsA.id));
});

test('routes workspace settings to members by default', async ({page, auth, workspaces}) => {
  const user = await auth.createUser();
  const workspace = await workspaces.create({userId: user.user.id, name: 'Settings Workspace'});
  await auth.loginAs(page, user);
  await completeWorkspaceSetup(page, workspace.id);

  await page.goto(`/workspaces/${workspace.id}/settings`);

  await expect(page).toHaveURL(new RegExp(`/workspaces/${workspace.id}/settings/members/?$`, 'u'));
  await expect(page.getByRole('heading', {name: 'Members'})).toBeVisible();
});

test('routes setup workspace settings back to source-control onboarding', async ({
  page,
  auth,
  workspaces,
}) => {
  const user = await auth.createUser();
  const workspace = await workspaces.create({
    userId: user.user.id,
    name: 'Setup Settings Workspace',
  });
  await auth.loginAs(page, user);

  await page.goto(`/workspaces/${workspace.id}/settings`);

  await expect(page).toHaveURL(new RegExp(`/workspaces/${workspace.id}/integrations/?$`, 'u'));
  await expect(page.getByRole('heading', {name: 'Connect source control'})).toBeVisible();
  await expectSetupNavigationHidden(page);
});

test('settings tab opens members settings', async ({page, auth, workspaces}) => {
  const user = await auth.createUser();
  const workspace = await workspaces.create({userId: user.user.id, name: 'Settings Tab Workspace'});
  await auth.loginAs(page, user);
  await completeWorkspaceSetup(page, workspace.id);

  await page.goto(`/workspaces/${workspace.id}`);
  await page.getByRole('tab', {name: 'Settings'}).click();

  await expect(page).toHaveURL(new RegExp(`/workspaces/${workspace.id}/settings/members/?$`, 'u'));
  await expect(page.getByRole('heading', {name: 'Members'})).toBeVisible();
});

test('creates a second workspace from the switcher mid-session', async ({
  page,
  auth,
  workspaces,
}) => {
  const user = await auth.createUser();
  const workspaceAName = 'Alpha Workspace';
  const workspaceBName = 'Beta Workspace';
  const wsA = await workspaces.create({userId: user.user.id, name: workspaceAName});
  await auth.loginAs(page, user);

  await page.goto(`/workspaces/${wsA.id}`);
  await page.getByLabel('Switch workspace').click();
  await expect(page.getByRole('option', {name: workspaceAName})).toBeVisible();
  await expect(page.getByRole('option', {name: CREATE_WORKSPACE_LABEL_RE})).toBeVisible();
  await argosScreenshot(page, 'workspaces/switcher-single-with-create');

  await page.getByRole('option', {name: CREATE_WORKSPACE_LABEL_RE}).click();
  await expect(page).toHaveURL(ONBOARDING_URL_RE);

  await page.getByLabel('Workspace name').fill(workspaceBName);
  await page.getByRole('button', {name: 'Create workspace'}).click();

  await expect(page).toHaveURL(WORKSPACE_INTEGRATIONS_URL_RE);
  await expectSetupNavigationHidden(page);
  const newWid = new URL(page.url()).pathname.split('/')[2];
  expect(newWid).toBeTruthy();
  expect(newWid).not.toBe(wsA.id);

  await page.getByLabel('Switch workspace').click();
  await expect(page.getByRole('option', {name: workspaceAName})).toBeVisible();
  await expect(page.getByRole('option', {name: workspaceBName})).toBeVisible();
  expect(await readLastWorkspaceId(page)).toBe(newWid);
});

test('switcher keeps Create workspace visible when search filters every workspace out', async ({
  page,
  auth,
  workspaces,
}) => {
  const user = await auth.createUser();
  const wsA = await workspaces.create({userId: user.user.id, name: 'Alpha Workspace'});
  await auth.loginAs(page, user);

  await page.goto(`/workspaces/${wsA.id}`);
  await page.getByLabel('Switch workspace').click();
  await page.getByPlaceholder('Search workspaces...').fill('zzz-no-match');

  // forceMount on both the create CommandGroup and CommandItem keeps the
  // footer rendered when cmdk would otherwise hide its parent group because
  // no items match the filter. Without forceMount on the group, the
  // CommandItem stays in the DOM but its parent gets [hidden].
  await expect(page.getByText('No workspaces found.')).toBeVisible();
  await expect(page.getByRole('option', {name: CREATE_WORKSPACE_LABEL_RE})).toBeVisible();
  await argosScreenshot(page, 'workspaces/switcher-empty-search');

  // The create item is the only forceMount-ed option, so cmdk auto-selects
  // it. Enter must navigate via the onSelect handler — if it falls back to
  // a Link's native click, keyboard users get nothing.
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(ONBOARDING_URL_RE);
});

test('switcher list scrolls while Create workspace stays pinned', async ({
  page,
  auth,
  workspaces,
}) => {
  const user = await auth.createUser();
  const first = await workspaces.create({userId: user.user.id, name: 'Workspace 01'});
  for (let i = 2; i <= 20; i++) {
    const name = `Workspace ${String(i).padStart(2, '0')}`;
    await workspaces.create({userId: user.user.id, name});
  }
  await auth.loginAs(page, user);

  await page.goto(`/workspaces/${first.id}`);
  await expect(page).toHaveURL(workspaceUrlRe(first.id));

  await page.getByLabel('Switch workspace').click();
  await expect(page.getByRole('option', {name: 'Workspace 01'})).toBeVisible();
  await expect(page.getByRole('option', {name: CREATE_WORKSPACE_LABEL_RE})).toBeVisible();
  await argosScreenshot(page, 'workspaces/switcher-many-overflow');

  // Scroll the inner max-h-300 container to the bottom. Walk up from a
  // workspace option until we hit the first ancestor whose content overflows
  // its box — that is the scrollable div wrapping the Workspaces CommandGroup.
  // The Create workspace footer is a sibling of that div, so scrolling it
  // cannot move the footer; the second snapshot proves that.
  await page.evaluate(() => {
    let el = document.querySelector('[role="option"]')?.parentElement ?? null;
    while (el && el.scrollHeight <= el.clientHeight) {
      el = el.parentElement;
    }
    if (el) el.scrollTop = el.scrollHeight;
  });
  await expect(page.getByRole('option', {name: 'Workspace 20'})).toBeInViewport();
  await expect(page.getByRole('option', {name: CREATE_WORKSPACE_LABEL_RE})).toBeVisible();
  await argosScreenshot(page, 'workspaces/switcher-many-overflow-scrolled');
});

test('routes a returning user with workspaces straight to /workspaces/$wid', async ({
  page,
  auth,
  workspaces,
}) => {
  const user = await auth.createUser();
  const wsA = await workspaces.create({userId: user.user.id, name: 'Alpha Workspace'});
  await auth.loginAs(page, user);

  // Capture transient redirects while auth refresh resolves memberships;
  // asserting only the final URL would let a brief setup-page flash slip past
  // Playwright auto-wait.
  const urlsSeen: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      urlsSeen.push(frame.url());
    }
  });

  await page.goto('/');
  await expect(page).toHaveURL(workspaceUrlRe(wsA.id));

  for (const url of urlsSeen) {
    expect(url, `transit URL must not flash through onboarding: ${url}`).not.toMatch(
      ONBOARDING_URL_RE,
    );
  }
  await argosScreenshot(page, 'workspaces/returning-user-home');
});
