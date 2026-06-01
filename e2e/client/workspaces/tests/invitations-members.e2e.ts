import {randomUUID} from 'node:crypto';
import type {Page} from '@shipfox/playwright';
import {argosScreenshot} from '@shipfox/playwright';
import {expect, test} from './test.js';

const PENDING_INVITATION_RE = /open invitation already exists/u;
const VISUAL_OWNER_EMAIL = 'owner@example.test';
const VISUAL_INVITEE_EMAIL = 'invitee@example.test';
const VISUAL_PENDING_EMAIL = 'pending-invitee@example.test';
const VISUAL_JOINED_DATE = 'May 1, 2026';
const VISUAL_EXPIRES_DATE = 'May 20, 2026';

function workspaceUrlRe(wid: string): RegExp {
  return new RegExp(`/workspaces/${wid}(/|$)`, 'u');
}

function textRe(text: string): RegExp {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u');
}

async function stableArgosScreenshot(
  page: Page,
  name: string,
  replacements: ReadonlyArray<readonly [string, string]> = [],
): Promise<void> {
  await argosScreenshot(page, name, {
    beforeScreenshot: async () => {
      await page.evaluate((visualReplacements) => {
        type RestoreEntry =
          | {kind: 'attribute'; target: Element; attribute: string; value: string}
          | {kind: 'text'; target: Text; value: string}
          | {kind: 'value'; target: HTMLInputElement | HTMLTextAreaElement; value: string};
        const visualWindow = window as Window & {__shipfoxVisualRestore?: RestoreEntry[]};
        const restoreEntries: RestoreEntry[] = [];
        const replaceValue = (value: string): string =>
          visualReplacements.reduce(
            (current, [source, replacement]) => current.split(source).join(replacement),
            value,
          );

        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
          const textNode = node as Text;
          const nextValue = replaceValue(textNode.data);
          if (nextValue !== textNode.data) {
            restoreEntries.push({kind: 'text', target: textNode, value: textNode.data});
            textNode.data = nextValue;
          }
          node = walker.nextNode();
        }

        for (const element of document.querySelectorAll('input, textarea')) {
          if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
            const nextValue = replaceValue(element.value);
            if (nextValue !== element.value) {
              restoreEntries.push({kind: 'value', target: element, value: element.value});
              element.value = nextValue;
            }
          }
        }

        for (const element of document.querySelectorAll('[aria-label], [placeholder], [title]')) {
          for (const attribute of ['aria-label', 'placeholder', 'title']) {
            const value = element.getAttribute(attribute);
            if (value == null) continue;
            const nextValue = replaceValue(value);
            if (nextValue !== value) {
              restoreEntries.push({kind: 'attribute', target: element, attribute, value});
              element.setAttribute(attribute, nextValue);
            }
          }
        }

        visualWindow.__shipfoxVisualRestore = restoreEntries;
      }, replacements);
    },
    afterScreenshot: async () => {
      await page.evaluate(() => {
        type RestoreEntry =
          | {kind: 'attribute'; target: Element; attribute: string; value: string}
          | {kind: 'text'; target: Text; value: string}
          | {kind: 'value'; target: HTMLInputElement | HTMLTextAreaElement; value: string};
        const visualWindow = window as Window & {__shipfoxVisualRestore?: RestoreEntry[]};
        const restoreEntries = visualWindow.__shipfoxVisualRestore ?? [];

        for (const entry of restoreEntries.reverse()) {
          if (entry.kind === 'text') {
            entry.target.data = entry.value;
          } else if (entry.kind === 'value') {
            entry.target.value = entry.value;
          } else {
            entry.target.setAttribute(entry.attribute, entry.value);
          }
        }

        delete visualWindow.__shipfoxVisualRestore;
      });
    },
  });
}

test('accepts an invitation from the public landing page via login', async ({
  page,
  auth,
  workspaces,
}) => {
  const owner = await auth.createUser({name: 'Owner User'});
  const invitee = await auth.createUser({name: 'Invitee User'});
  const workspace = await workspaces.create({
    userId: owner.user.id,
    userEmail: owner.email,
    userName: owner.user.name,
    name: 'Invitation Flow Workspace',
  });
  const invitation = await workspaces.createInvitation({
    workspaceId: workspace.id,
    email: invitee.email,
    invitedByUserId: owner.user.id,
    invitedByDisplay: 'Owner User',
  });

  await page.goto(`/invitations/accept?token=${encodeURIComponent(invitation.raw_token)}`);
  await expect(page.getByRole('heading', {name: 'Invitation Flow Workspace'})).toBeVisible();
  await expect(page.getByText(`Invited by Owner User to join as ${invitee.email}.`)).toBeVisible();
  await stableArgosScreenshot(page, 'invitations/pending-unauth', [
    [owner.email, VISUAL_OWNER_EMAIL],
    [invitee.email, VISUAL_INVITEE_EMAIL],
  ]);

  await page.getByRole('link', {name: 'I already have an account'}).click();
  await expect(page.getByRole('heading', {name: 'Join Invitation Flow Workspace'})).toBeVisible();
  const emailInput = page.getByLabel('Email');
  await expect(emailInput).toHaveValue(invitee.email);
  await expect(emailInput).toHaveJSProperty('readOnly', true);
  await expect(page.getByText('Joining Invitation Flow Workspace.')).toBeHidden();

  await page.getByRole('link', {name: 'Create an account'}).click();
  await expect(page.getByRole('heading', {name: 'Join Invitation Flow Workspace'})).toBeVisible();
  const signupEmailInput = page.getByLabel('Email');
  await expect(signupEmailInput).toHaveValue(invitee.email);
  await expect(signupEmailInput).toHaveJSProperty('readOnly', true);

  await page.getByRole('link', {name: 'Log in'}).click();
  await expect(page.getByRole('heading', {name: 'Join Invitation Flow Workspace'})).toBeVisible();
  await expect(page.getByLabel('Email')).toHaveValue(invitee.email);

  await page.getByLabel('Password').fill(invitee.password);
  await page.getByRole('button', {name: 'Log in'}).click();

  await expect(page).toHaveURL(workspaceUrlRe(workspace.id));
  await expect(page.getByText('You joined Invitation Flow Workspace.')).toBeVisible();

  await page.goto(`/workspaces/${workspace.id}/settings/members`);
  await expect(page.getByRole('heading', {name: 'Members'})).toBeVisible();
  await expect(page.getByText(owner.email)).toBeVisible();
  await expect(page.getByText(invitee.email)).toBeVisible();
  await expect(page.getByText('No pending invitations.')).toBeVisible();
  const memberJoinedText = (
    await page
      .getByRole('row', {name: textRe(invitee.email)})
      .getByRole('cell')
      .nth(2)
      .innerText()
  ).trim();
  await stableArgosScreenshot(page, 'members/populated-with-empty-invitations', [
    [owner.email, VISUAL_OWNER_EMAIL],
    [invitee.email, VISUAL_INVITEE_EMAIL],
    [memberJoinedText, VISUAL_JOINED_DATE],
  ]);
});

test('creates an account from an invitation with the email locked', async ({
  page,
  auth,
  workspaces,
}) => {
  const owner = await auth.createUser({name: 'Signup Owner'});
  const workspace = await workspaces.create({
    userId: owner.user.id,
    userEmail: owner.email,
    userName: owner.user.name,
    name: 'Invitation Signup Workspace',
  });
  const inviteeEmail = `signup-invitee-${randomUUID()}@example.test`;
  const invitation = await workspaces.createInvitation({
    workspaceId: workspace.id,
    email: inviteeEmail,
    invitedByUserId: owner.user.id,
    invitedByDisplay: 'Signup Owner',
  });

  await page.goto(`/invitations/accept?token=${encodeURIComponent(invitation.raw_token)}`);
  await page.getByRole('link', {name: 'Create account'}).click();

  await expect(page.getByRole('heading', {name: 'Join Invitation Signup Workspace'})).toBeVisible();
  const emailInput = page.getByLabel('Email');
  await expect(emailInput).toHaveValue(inviteeEmail);
  await expect(emailInput).toHaveJSProperty('readOnly', true);
  await expect(page.getByText('Joining Invitation Signup Workspace.')).toBeHidden();

  await page.getByLabel('Name').fill('Signup Invitee');
  await page.getByLabel('Password').fill('correct horse battery staple');
  await page.getByRole('button', {name: 'Create account'}).click();

  await expect(page).toHaveURL(workspaceUrlRe(workspace.id));
  await expect(page.getByText('You joined Invitation Signup Workspace.')).toBeVisible();

  await page.goto(`/workspaces/${workspace.id}/settings/members`);
  await expect(page.getByText(inviteeEmail)).toBeVisible();
  await expect(page.getByText('Signup Invitee')).toBeVisible();
});

test('creates, rejects duplicate, and revokes a pending invitation from members settings', async ({
  page,
  auth,
  workspaces,
}) => {
  const owner = await auth.createUser({name: 'Settings Owner'});
  const workspace = await workspaces.create({
    userId: owner.user.id,
    userEmail: owner.email,
    userName: owner.user.name,
    name: 'Members Settings Workspace',
  });
  const pendingEmail = `pending-${randomUUID()}@example.test`;
  await auth.loginAs(page, owner);

  await page.goto(`/workspaces/${workspace.id}/settings/members`);
  await expect(page.getByRole('heading', {name: 'Pending invitations'})).toBeVisible();
  await expect(page.getByText('No pending invitations.')).toBeVisible();
  const ownerJoinedText = (
    await page
      .getByRole('row', {name: textRe(owner.email)})
      .getByRole('cell')
      .nth(2)
      .innerText()
  ).trim();
  const ownerRowReplacements = [
    [owner.email, VISUAL_OWNER_EMAIL],
    [ownerJoinedText, VISUAL_JOINED_DATE],
  ] as const;
  await stableArgosScreenshot(page, 'members/pending-invitations-empty', ownerRowReplacements);

  await page.getByRole('button', {name: 'Invite member'}).click();
  await expect(page.getByRole('heading', {name: 'Invite a member'})).toBeVisible();
  await expect(page.getByLabel('Email')).toBeFocused();
  await stableArgosScreenshot(page, 'members/invite-member-modal-idle', ownerRowReplacements);

  await page.getByLabel('Email').fill(pendingEmail);
  await page.getByRole('button', {name: 'Send invitation'}).click();
  await expect(page.getByText(`Invitation sent to ${pendingEmail}.`)).toBeVisible();
  const pendingInvitationRow = page.getByRole('row', {name: textRe(pendingEmail)});
  await expect(pendingInvitationRow).toBeVisible();
  const pendingExpiresText = (
    await pendingInvitationRow.getByRole('cell').nth(2).innerText()
  ).trim();
  const pendingRowReplacements = [
    [owner.email, VISUAL_OWNER_EMAIL],
    [pendingEmail, VISUAL_PENDING_EMAIL],
    [ownerJoinedText, VISUAL_JOINED_DATE],
    [pendingExpiresText, VISUAL_EXPIRES_DATE],
  ] as const;
  await stableArgosScreenshot(
    page,
    'members/pending-invitations-populated',
    pendingRowReplacements,
  );

  await page.getByRole('button', {name: 'Invite member'}).click();
  await expect(page.getByRole('heading', {name: 'Invite a member'})).toBeVisible();
  await expect(page.getByLabel('Email')).toBeFocused();
  await page.getByLabel('Email').fill(pendingEmail);
  await page.getByRole('button', {name: 'Send invitation'}).click();
  await expect(page.getByText(PENDING_INVITATION_RE)).toBeVisible();
  await stableArgosScreenshot(page, 'members/invite-member-modal-conflict', pendingRowReplacements);
  await page.keyboard.press('Escape');

  await pendingInvitationRow.hover();
  await page.getByRole('button', {name: 'Revoke invitation'}).click();
  await expect(page.getByText(`Revoke invitation to ${pendingEmail}?`)).toBeVisible();
  await stableArgosScreenshot(page, 'members/revoke-invitation-confirm', pendingRowReplacements);
  await page.getByRole('button', {name: 'Revoke'}).click();

  await expect(page.getByText(`Invitation to ${pendingEmail} revoked.`)).toBeVisible();
  await expect(pendingInvitationRow).toBeHidden();
});

test('renders terminal public invitation states', async ({page}) => {
  await page.goto('/invitations/accept');
  await expect(page.getByRole('heading', {name: 'Invalid link'})).toBeVisible();
  await argosScreenshot(page, 'invitations/missing-token');

  await page.route('**/invitations/preview?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({status: 'invalid'}),
    });
  });
  await page.goto(`/invitations/accept?token=${encodeURIComponent(`invalid-${randomUUID()}`)}`);
  await expect(page.getByRole('heading', {name: 'Invalid invitation'})).toBeVisible();
  await argosScreenshot(page, 'invitations/invalid');

  await page.unroute('**/invitations/preview?**');
  await page.route('**/invitations/preview?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'expired',
        workspace_name: 'Expired Workspace',
        expires_at: '2026-05-01T00:00:00.000Z',
      }),
    });
  });
  await page.goto(`/invitations/accept?token=${encodeURIComponent(`expired-${randomUUID()}`)}`);
  await expect(page.getByRole('heading', {name: 'Invitation expired'})).toBeVisible();
  await argosScreenshot(page, 'invitations/expired');
});
