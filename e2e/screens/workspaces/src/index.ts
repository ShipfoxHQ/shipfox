import {Dialog, SettingsShell} from '@shipfox/e2e-kit/ui';
import type {Page} from '@shipfox/playwright';

type Locator = ReturnType<Page['locator']>;
type FixtureUse<T> = (fixture: T) => Promise<void>;
const LAST_WORKSPACE_KEY = 'shipfox.lastWorkspaceId';

export class WorkspaceOnboardingScreen {
  constructor(private readonly page: Page) {}

  async gotoRoot(): Promise<void> {
    await this.page.goto('/');
  }

  async gotoWorkspace(workspaceId: string): Promise<void> {
    await this.page.goto(`/workspaces/${workspaceId}`);
  }

  heading(): Locator {
    return this.page.getByRole('heading', {name: 'Create your workspace'});
  }

  workspaceNameField(): Locator {
    return this.page.getByLabel('Workspace name');
  }

  createWorkspaceButton(): Locator {
    return this.page.getByRole('button', {name: 'Create workspace'});
  }

  async createWorkspace(name: string): Promise<void> {
    await this.workspaceNameField().fill(name);
    await this.createWorkspaceButton().click();
  }
}

export class WorkspaceHomeScreen {
  constructor(private readonly page: Page) {}

  async gotoRoot(): Promise<void> {
    await this.page.goto('/');
  }

  async goto(workspaceId: string): Promise<void> {
    await this.page.goto(`/workspaces/${workspaceId}`);
  }

  async gotoIntegrations(workspaceId: string): Promise<void> {
    await this.page.goto(`/workspaces/${workspaceId}/integrations`);
  }

  async gotoSettings(workspaceId: string): Promise<void> {
    await this.page.goto(`/workspaces/${workspaceId}/settings`);
  }

  settingsTab(): Locator {
    return this.page.getByRole('tab', {name: 'Settings'});
  }

  currentWorkspaceId(): string | undefined {
    return new URL(this.page.url()).pathname.split('/')[2];
  }

  async readMaybeLastWorkspaceId(): Promise<string | undefined> {
    const raw = await this.page.evaluate(
      (key) => window.localStorage.getItem(key),
      LAST_WORKSPACE_KEY,
    );
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'string' ? parsed : undefined;
  }

  async readLastWorkspaceId(): Promise<string> {
    const workspaceId = await this.readMaybeLastWorkspaceId();
    if (workspaceId === undefined) {
      throw new Error(`localStorage[${LAST_WORKSPACE_KEY}] is not set`);
    }
    return workspaceId;
  }
}

export class MembersSettingsScreen {
  private readonly shell: SettingsShell;

  constructor(private readonly page: Page) {
    this.shell = new SettingsShell(page);
  }

  async goto(workspaceId: string): Promise<void> {
    await this.shell.goto(workspaceId, 'members');
  }

  async gotoDefault(workspaceId: string): Promise<void> {
    await this.page.goto(`/workspaces/${workspaceId}/settings`);
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
  workspaceHome: WorkspaceHomeScreen;
  workspaceOnboarding: WorkspaceOnboardingScreen;
}

export const workspacesScreens = {
  invitationAccept: async ({page}: {page: Page}, use: FixtureUse<InvitationAcceptScreen>) => {
    await use(new InvitationAcceptScreen(page));
  },
  membersSettings: async ({page}: {page: Page}, use: FixtureUse<MembersSettingsScreen>) => {
    await use(new MembersSettingsScreen(page));
  },
  workspaceHome: async ({page}: {page: Page}, use: FixtureUse<WorkspaceHomeScreen>) => {
    await use(new WorkspaceHomeScreen(page));
  },
  workspaceOnboarding: async ({page}: {page: Page}, use: FixtureUse<WorkspaceOnboardingScreen>) => {
    await use(new WorkspaceOnboardingScreen(page));
  },
};
