import {randomUUID} from 'node:crypto';
import {argosScreenshot} from '@shipfox/playwright';
import {expect, test} from './test.js';

const LOGIN_URL_RE = /\/auth\/login$/u;
const ONBOARDING_URL_RE = /\/setup\/workspaces\/new\/?$/u;

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
