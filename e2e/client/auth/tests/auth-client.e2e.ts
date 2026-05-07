import {randomUUID} from 'node:crypto';
import {argosScreenshot} from '@shipfox/playwright';
import {expect, test} from './test.js';

const LOGIN_URL_RE = /\/auth\/login$/u;
const LOGIN_WITH_REDIRECT_URL_RE = /\/auth\/login\?redirect=/u;
const ONBOARDING_URL_RE = /\/setup\/workspaces\/new\/?$/u;
const ANY_WORKSPACE_URL_RE = /\/workspaces\//u;

function workspaceUrlRe(wid: string): RegExp {
  return new RegExp(`/workspaces/${wid}(/|$)`, 'u');
}

test('redirects guests from the app root to login', async ({page}) => {
  await page.goto('/');

  await expect(page).toHaveURL(LOGIN_URL_RE);
  await expect(page.getByRole('heading', {name: 'Connect to Shipfox'})).toBeVisible();
  await argosScreenshot(page, 'auth/login');
});

test('logs in through the UI with an E2E-created verified user', async ({page, auth}) => {
  const user = await auth.createUser();

  await page.goto('/auth/login');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', {name: 'Log in'}).click();

  await expect(page.getByRole('heading', {name: 'Create your workspace'})).toBeVisible();
  await argosScreenshot(page, 'auth/post-login-workspace');
});

test('form login routes a user with workspaces straight to /workspaces/$wid', async ({
  page,
  auth,
  workspaces,
}) => {
  const user = await auth.createUser();
  const wsA = await workspaces.create({userId: user.user.id, name: `A ${randomUUID()}`});

  // Record every URL the page transits through. Asserting only the final URL
  // would let a brief flash through /setup/workspaces/new slip past
  // Playwright auto-wait — that flash is the bug we're guarding against.
  const urlsSeen: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      urlsSeen.push(frame.url());
    }
  });

  await page.goto('/auth/login');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', {name: 'Log in'}).click();

  await expect(page).toHaveURL(workspaceUrlRe(wsA.id));

  for (const url of urlsSeen) {
    expect(url, `transit URL must not flash through onboarding: ${url}`).not.toMatch(
      ONBOARDING_URL_RE,
    );
  }
});

test('hydrates an E2E browser session from the refresh cookie after reload', async ({
  page,
  auth,
}) => {
  const user = await auth.createUser();
  await auth.loginAs(page, user);

  await page.goto('/');
  await expect(page.getByRole('heading', {name: 'Create your workspace'})).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', {name: 'Create your workspace'})).toBeVisible();
});

test('restores a nested deep link after login', async ({page, auth, workspaces}) => {
  const user = await auth.createUser();
  const ws = await workspaces.create({userId: user.user.id, name: `DL ${randomUUID()}`});
  // Fresh E2E workspaces have no source connections, so CreateProjectPage will
  // redirect to /integrations the moment it mounts. The deep-link restore is
  // proven by the URL transiting *through* /projects/new before that redirect.
  const target = `/workspaces/${ws.id}/projects/new`;

  const urlsSeen: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      urlsSeen.push(frame.url());
    }
  });

  await page.goto(target);
  await expect(page).toHaveURL(LOGIN_WITH_REDIRECT_URL_RE);

  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  // Snapshot the navigation log before submit so the assertion ignores the
  // pre-login visit to `target` and only proves the post-login restore.
  const preLoginCount = urlsSeen.length;
  await page.getByRole('button', {name: 'Log in'}).click();

  await expect(page).toHaveURL(workspaceUrlRe(ws.id));

  const postLoginUrls = urlsSeen.slice(preLoginCount);
  const visitedNestedPath = postLoginUrls.some(
    (url) => new URL(url).pathname === `/workspaces/${ws.id}/projects/new`,
  );
  expect(
    visitedNestedPath,
    `expected URL to transit through /projects/new after login: ${postLoginUrls.join(', ')}`,
  ).toBe(true);
});

test('preserves search and hash in the deep link after login', async ({page, auth, workspaces}) => {
  const user = await auth.createUser();
  const ws = await workspaces.create({userId: user.user.id, name: `DL ${randomUUID()}`});
  // HomeRouter at /workspaces/$wid redirects fresh workspaces to /integrations
  // and that redirect drops the search/hash. The restore is proven by the URL
  // transiting through the original deep target with search and hash intact.
  const target = `/workspaces/${ws.id}?tab=runs#header`;

  const urlsSeen: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      urlsSeen.push(frame.url());
    }
  });

  await page.goto(target);
  await expect(page).toHaveURL(LOGIN_WITH_REDIRECT_URL_RE);

  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  // Snapshot the navigation log before submit so the assertion ignores the
  // pre-login visit to `target` and only proves the post-login restore.
  const preLoginCount = urlsSeen.length;
  await page.getByRole('button', {name: 'Log in'}).click();

  await expect(page).toHaveURL(workspaceUrlRe(ws.id));

  const postLoginUrls = urlsSeen.slice(preLoginCount);
  const visitedTargetWithSearchAndHash = postLoginUrls.some((url) => {
    const u = new URL(url);
    return (
      u.pathname === `/workspaces/${ws.id}` && u.search === '?tab=runs' && u.hash === '#header'
    );
  });
  expect(
    visitedTargetWithSearchAndHash,
    `expected URL to transit with ?tab=runs#header preserved: ${postLoginUrls.join(', ')}`,
  ).toBe(true);
});

test('blocks open-redirect to a cross-origin URL after login', async ({page, auth, workspaces}) => {
  const user = await auth.createUser();
  await workspaces.create({userId: user.user.id, name: `Block ${randomUUID()}`});

  await page.goto('/auth/login?redirect=//evil.com');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', {name: 'Log in'}).click();

  await expect(page).toHaveURL(ANY_WORKSPACE_URL_RE);
  expect(page.url()).not.toContain('evil.com');
});

test('routes an already-authenticated visitor of /auth/login?redirect= straight to the deep link', async ({
  page,
  auth,
  workspaces,
}) => {
  const user = await auth.createUser();
  const ws = await workspaces.create({userId: user.user.id, name: `Auth ${randomUUID()}`});
  await auth.loginAs(page, user);

  await page.goto(`/auth/login?redirect=/workspaces/${ws.id}`);

  await expect(page).toHaveURL(workspaceUrlRe(ws.id));
  await expect(page.getByRole('heading', {name: 'Connect to Shipfox'})).not.toBeVisible();
});

test('restores a /setup deep link for a workspace-less user after login', async ({page, auth}) => {
  const user = await auth.createUser();

  await page.goto('/setup/workspaces/new');
  await expect(page).toHaveURL(LOGIN_WITH_REDIRECT_URL_RE);

  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', {name: 'Log in'}).click();

  await expect(page).toHaveURL(ONBOARDING_URL_RE);
});
