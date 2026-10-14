import type {Page} from '@shipfox/playwright';

type Locator = ReturnType<Page['locator']>;
type FixtureUse<T> = (fixture: T) => Promise<void>;

/** Page object for the workflow run workspace and its job detail routes. */
export class WorkflowRunScreen {
  constructor(private readonly page: Page) {}

  async openRun(runId: string): Promise<void> {
    await this.page.goto(`/runs/${encodeURIComponent(runId)}`);
  }

  job(name: string): WorkflowRunJobScreen {
    return new WorkflowRunJobScreen(this.page, name);
  }

  /** The action offered by the current job notice, when one is rendered. */
  requiredAction(): RequiredActionScreen {
    return new RequiredActionScreen(this.page);
  }
}

export class WorkflowRunJobScreen {
  constructor(
    private readonly page: Page,
    private readonly name: string,
  ) {}

  private jobNavigationLink(): Locator {
    return this.page.getByRole('link', {
      name: new RegExp(`^${escapeRegExp(this.name)}(?:,|\\s|$)`, 'u'),
    });
  }

  async open(): Promise<void> {
    await this.jobNavigationLink().click();
  }

  statusReason(): Locator {
    return this.page.getByRole('region', {
      name: new RegExp(`${escapeRegExp(this.name)} logs`, 'u'),
    });
  }
}

export class RequiredActionScreen {
  constructor(private readonly page: Page) {}

  label(): Locator {
    return this.action();
  }

  href(): Locator {
    return this.page.locator('a[data-appearance="link"], a[data-appearance="button"]');
  }

  async click(): Promise<void> {
    await this.action().click();
  }

  private action(): Locator {
    return this.page.locator('[data-appearance="link"], [data-appearance="button"]').last();
  }
}

export interface WorkflowsScreenFixtures {
  workflowRun: WorkflowRunScreen;
}

export const workflowsScreens = {
  workflowRun: async ({page}: {page: Page}, use: FixtureUse<WorkflowRunScreen>) => {
    await use(new WorkflowRunScreen(page));
  },
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
