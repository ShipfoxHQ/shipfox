/// <reference lib="dom" />

import type {Page} from '@shipfox/playwright';

type Locator = ReturnType<Page['locator']>;
type FixtureUse<T> = (fixture: T) => Promise<void>;

// Mirrors the shell's first-run greeting key, so the greeting doesn't cover the page.
const SHIPPY_GREETED_KEY = 'shipfox.shippy.greeted';

/** The Shippy chat panel beside a project page. */
export class ShippyChatScreen {
  constructor(private readonly page: Page) {}

  async gotoProject(params: {workspaceSlug: string; projectSlug: string}): Promise<void> {
    await this.page.addInitScript((key) => {
      window.localStorage.setItem(key, 'true');
    }, SHIPPY_GREETED_KEY);
    await this.page.goto(`/w/${params.workspaceSlug}/p/${params.projectSlug}/runs`);
  }

  async open(): Promise<void> {
    await this.page.getByRole('button', {name: 'Open Shippy, your project agent'}).click();
  }

  /** Docked beside a wide page, or a sheet over a narrow one. */
  panel(): Locator {
    return this.page
      .getByRole('complementary', {name: 'Shippy'})
      .or(this.page.getByRole('dialog', {name: 'Shippy'}));
  }

  async send(message: string): Promise<void> {
    await this.panel().getByRole('textbox', {name: 'Message Shippy'}).fill(message);
    await this.panel().getByRole('button', {name: 'Send message'}).click();
  }

  messages(): Locator {
    return this.panel().getByLabel('Messages');
  }

  message(text: string): Locator {
    return this.messages().getByText(text, {exact: true});
  }

  /** A tool call row, by the label the chat gives the tool, such as `List Workflow Runs`. */
  toolCall(label: string): Locator {
    // The row's name starts with its status, as in `Succeeded List Workflow Runs {}`.
    return this.messages().getByRole('button', {name: label});
  }

  stoppedFooter(): Locator {
    return this.messages().getByText('Stopped', {exact: true});
  }

  async stopReply(): Promise<void> {
    await this.panel().getByRole('button', {name: 'Stop reply'}).click();
  }

  failure(): Locator {
    return this.messages().getByText("Shippy couldn't reply.", {exact: true});
  }

  async retry(): Promise<void> {
    await this.messages().getByRole('button', {name: 'Retry'}).click();
  }

  async showConversations(): Promise<void> {
    await this.panel().getByRole('button', {name: 'Show conversations'}).click();
  }

  emptyHistory(): Locator {
    return this.panel().getByText('No conversations yet', {exact: true});
  }
}

export interface ChatScreenFixtures {
  shippyChat: ShippyChatScreen;
}

export const chatScreens = {
  shippyChat: async ({page}: {page: Page}, use: FixtureUse<ShippyChatScreen>) => {
    await use(new ShippyChatScreen(page));
  },
};
