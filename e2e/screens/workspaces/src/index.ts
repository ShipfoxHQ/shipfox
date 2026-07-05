import {Dialog, SettingsShell} from '@shipfox/e2e-kit/ui';
import type {Page} from '@shipfox/playwright';

type Locator = ReturnType<Page['locator']>;
type FixtureUse<T> = (fixture: T) => Promise<void>;

export class MembersSettingsScreen {
  private readonly shell: SettingsShell;

  constructor(private readonly page: Page) {
    this.shell = new SettingsShell(page);
  }

  async goto(workspaceId: string): Promise<void> {
    await this.shell.goto(workspaceId, 'members');
  }

  heading(): Locator {
    return this.page.getByRole('heading', {name: 'Members'});
  }

  pendingInvitationsHeading(): Locator {
    return this.page.getByRole('heading', {name: 'Pending invitations'});
  }

  emptyPendingInvitations(): Locator {
    return this.page.getByText('No pending invitations.');
  }

  memberText(text: string | RegExp): Locator {
    return this.page.getByText(text);
  }

  memberRow(text: string | RegExp): Locator {
    return this.page.getByRole('row', {name: text});
  }

  async memberCellText(rowName: string | RegExp, index: number): Promise<string> {
    return (await this.memberRow(rowName).getByRole('cell').nth(index).innerText()).trim();
  }

  inviteButton(): Locator {
    return this.page.getByRole('button', {name: 'Invite member'});
  }

  async openInviteDialog(): Promise<Dialog> {
    await this.inviteButton().click();
    const dialog = new Dialog(this.page, 'Invite a member');
    await dialog.expectVisible();
    return dialog;
  }

  pendingInvitationRow(email: string | RegExp): Locator {
    return this.page.getByRole('row', {name: email});
  }

  async pendingInvitationExpiresText(email: string | RegExp): Promise<string> {
    return (await this.pendingInvitationRow(email).getByRole('cell').nth(2).innerText()).trim();
  }

  revokeInvitationButton(): Locator {
    return this.page.getByRole('button', {name: 'Revoke invitation'});
  }

  confirmRevokeButton(): Locator {
    return this.page.getByRole('button', {name: 'Revoke'});
  }
}

export class InvitationAcceptScreen {
  constructor(private readonly page: Page) {}

  async goto(rawToken?: string): Promise<void> {
    const suffix = rawToken === undefined ? '' : `?token=${encodeURIComponent(rawToken)}`;
    await this.page.goto(`/invitations/accept${suffix}`);
  }

  heading(name: string | RegExp): Locator {
    return this.page.getByRole('heading', {name});
  }

  message(text: string | RegExp): Locator {
    return this.page.getByText(text);
  }

  link(name: string | RegExp): Locator {
    return this.page.getByRole('link', {name});
  }

  field(name: string | RegExp): Locator {
    return this.page.getByLabel(name);
  }

  button(name: string | RegExp): Locator {
    return this.page.getByRole('button', {name});
  }
}

export interface WorkspacesScreenFixtures {
  invitationAccept: InvitationAcceptScreen;
  membersSettings: MembersSettingsScreen;
}

export const workspacesScreens = {
  invitationAccept: async ({page}: {page: Page}, use: FixtureUse<InvitationAcceptScreen>) => {
    await use(new InvitationAcceptScreen(page));
  },
  membersSettings: async ({page}: {page: Page}, use: FixtureUse<MembersSettingsScreen>) => {
    await use(new MembersSettingsScreen(page));
  },
};
