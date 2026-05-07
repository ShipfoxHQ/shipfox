import {randomUUID} from 'node:crypto';
import {argosScreenshot} from '@shipfox/playwright';
import {expect, test} from './test.js';

const ONBOARDING_URL_RE = /\/setup\/workspaces\/new\/?$/u;
const WORKSPACE_INTEGRATIONS_URL_RE = /\/workspaces\/[^/]+\/integrations\/?$/u;
const CREATE_WORKSPACE_LABEL_RE = /Create workspace/u;
const LAST_WORKSPACE_KEY = 'shipfox.lastWorkspaceId';

function workspaceUrlRe(wid: string): RegExp {
  return new RegExp(`/workspaces/${wid}(/|$)`, 'u');
}

async function readLastWorkspaceId(page: import('@shipfox/playwright').Page): Promise<string> {
  const raw = await page.evaluate((key) => window.localStorage.getItem(key), LAST_WORKSPACE_KEY);
  expect(raw, `localStorage[${LAST_WORKSPACE_KEY}]`).not.toBeNull();
  return JSON.parse(raw as string) as string;
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
  const workspaceName = `E2E Workspace ${randomUUID()}`;

  await page.goto('/');
  await expect(page).toHaveURL(ONBOARDING_URL_RE);
  await page.getByLabel('Workspace name').fill(workspaceName);
  await page.getByRole('button', {name: 'Create workspace'}).click();

  await expect(page).toHaveURL(WORKSPACE_INTEGRATIONS_URL_RE);
  await expect(page.getByRole('heading', {name: 'Connect source control'})).toBeVisible();
  const url = new URL(page.url());
  const wid = url.pathname.split('/')[2];
  expect(wid).toBeTruthy();
  expect(await readLastWorkspaceId(page)).toBe(wid);
  await argosScreenshot(page, 'workspaces/onboarding-complete');
});

test('switches between workspaces from the top nav', async ({page, auth, workspaces}) => {
  const user = await auth.createUser();
  const wsA = await workspaces.create({userId: user.user.id, name: `A ${randomUUID()}`});
  const wsB = await workspaces.create({userId: user.user.id, name: `B ${randomUUID()}`});
  await auth.loginAs(page, user);

  await page.goto(`/workspaces/${wsA.id}`);
  await expect(page).toHaveURL(workspaceUrlRe(wsA.id));

  await page.getByLabel('Switch workspace').click();
  await argosScreenshot(page, 'workspaces/switcher-open');
  await page.getByRole('option', {name: wsB.name}).click();

  await expect(page).toHaveURL(workspaceUrlRe(wsB.id));
  await expect(page.getByRole('link', {name: wsB.name})).toBeVisible();
  expect(await readLastWorkspaceId(page)).toBe(wsB.id);
});

test('persists the active workspace across reload and via /', async ({page, auth, workspaces}) => {
  const user = await auth.createUser();
  const wsA = await workspaces.create({userId: user.user.id, name: `A ${randomUUID()}`});
  const wsB = await workspaces.create({userId: user.user.id, name: `B ${randomUUID()}`});
  await auth.loginAs(page, user);

  await page.goto(`/workspaces/${wsB.id}/integrations`);
  await expect(page).toHaveURL(workspaceUrlRe(wsB.id));

  await page.reload();
  await expect(page).toHaveURL(workspaceUrlRe(wsB.id));

  await page.goto('/');
  await expect(page).toHaveURL(workspaceUrlRe(wsB.id));
  // Sanity: never landed on wsA.
  expect(page.url()).not.toMatch(workspaceUrlRe(wsA.id));
});

test('creates a second workspace from the switcher mid-session', async ({
  page,
  auth,
  workspaces,
}) => {
  const user = await auth.createUser();
  const wsA = await workspaces.create({userId: user.user.id, name: `A ${randomUUID()}`});
  await auth.loginAs(page, user);

  await page.goto(`/workspaces/${wsA.id}`);
  await page.getByLabel('Switch workspace').click();
  await expect(page.getByRole('option', {name: wsA.name})).toBeVisible();
  await expect(page.getByRole('option', {name: CREATE_WORKSPACE_LABEL_RE})).toBeVisible();
  await argosScreenshot(page, 'workspaces/switcher-single-with-create');

  await page.getByRole('option', {name: CREATE_WORKSPACE_LABEL_RE}).click();
  await expect(page).toHaveURL(ONBOARDING_URL_RE);

  const newName = `B ${randomUUID()}`;
  await page.getByLabel('Workspace name').fill(newName);
  await page.getByRole('button', {name: 'Create workspace'}).click();

  await expect(page).toHaveURL(WORKSPACE_INTEGRATIONS_URL_RE);
  const newWid = new URL(page.url()).pathname.split('/')[2];
  expect(newWid).toBeTruthy();
  expect(newWid).not.toBe(wsA.id);

  // Switcher now lists both workspaces.
  await page.getByLabel('Switch workspace').click();
  await expect(page.getByRole('option', {name: wsA.name})).toBeVisible();
  await expect(page.getByRole('option', {name: newName})).toBeVisible();
  expect(await readLastWorkspaceId(page)).toBe(newWid);
});

test('switcher keeps Create workspace visible when search filters every workspace out', async ({
  page,
  auth,
  workspaces,
}) => {
  const user = await auth.createUser();
  const wsA = await workspaces.create({userId: user.user.id, name: `A ${randomUUID()}`});
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

test('routes a returning user with workspaces straight to /workspaces/$wid', async ({
  page,
  auth,
  workspaces,
}) => {
  const user = await auth.createUser();
  const wsA = await workspaces.create({userId: user.user.id, name: `A ${randomUUID()}`});
  await auth.loginAs(page, user);

  // Record every URL the page transits through. The PR #23 regression was a
  // brief flash of /setup/workspaces/new while auth-refresh resolved
  // memberships; asserting only the final URL would let that flash slip
  // past Playwright auto-wait.
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
