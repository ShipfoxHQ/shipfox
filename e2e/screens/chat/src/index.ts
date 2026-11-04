import type {Page} from '@shipfox/playwright';

type Locator = ReturnType<Page['locator']>;
type FixtureUse<T> = (fixture: T) => Promise<void>;

/** Page object for the Shippy dock: the launcher on a project page and the chat panel beside it. */
export class ChatPanelScreen {
  constructor(private readonly page: Page) {}

  /** The project page the panel docks to. Runs is the landing page of a project. */
  async gotoRuns(workspaceSlug: string, projectSlug: string): Promise<void> {
    await this.page.goto(
      `/w/${encodeURIComponent(workspaceSlug)}/p/${encodeURIComponent(projectSlug)}/runs`,
    );
  }

  launcher(): Locator {
    return this.page.getByRole('button', {name: 'Open Shippy, your project agent'});
  }

  async open(): Promise<void> {
    await this.launcher().click();
    await this.panel().waitFor();
  }

  panel(): Locator {
    return this.page.getByRole('complementary', {name: 'Shippy'});
  }

  firstUseTitle(): Locator {
    return this.panel().getByText('Shippy, your project agent');
  }

  contextChip(text: string): Locator {
    return this.panel().getByText(text, {exact: true});
  }

  composer(): Locator {
    return this.panel().getByRole('textbox', {name: 'Message Shippy'});
  }

  async send(text: string): Promise<void> {
    await this.composer().fill(text);
    await this.panel().getByRole('button', {name: 'Send message'}).click();
  }

  stopButton(): Locator {
    return this.panel().getByRole('button', {name: 'Stop reply'});
  }

  messages(): Locator {
    return this.panel().getByRole('region', {name: 'Conversation with Shippy'});
  }

  message(text: string | RegExp): Locator {
    return this.messages().getByText(text);
  }

  stoppedMarker(): Locator {
    return this.messages().getByText('Stopped', {exact: true});
  }

  toolRow(label: string | RegExp): Locator {
    return this.messages().getByRole('button', {name: label});
  }

  failureNotice(): Locator {
    return this.panel().getByText("Shippy couldn't reply.");
  }

  retryButton(): Locator {
    return this.panel().getByRole('button', {name: 'Retry', exact: true});
  }

  async showConversations(): Promise<void> {
    await this.panel().getByRole('button', {name: 'Show conversations'}).click();
  }

  conversationRow(title: string | RegExp): Locator {
    return this.panel()
      .getByRole('list', {name: 'Conversations'})
      .getByRole('button', {name: title});
  }

  async deleteConversation(title: string): Promise<void> {
    await this.panel()
      .getByRole('button', {name: `Delete ${title}`})
      .click();
    await this.page
      .getByRole('dialog', {name: 'Delete this conversation?'})
      .getByRole('button', {name: 'Delete'})
      .click();
  }

  async close(): Promise<void> {
    await this.panel().getByRole('button', {name: 'Close Shippy'}).click();
  }
}

export interface ChatScreenFixtures {
  chatPanel: ChatPanelScreen;
}

export const chatScreens = {
  chatPanel: async ({page}: {page: Page}, use: FixtureUse<ChatPanelScreen>) => {
    await use(new ChatPanelScreen(page));
  },
};
