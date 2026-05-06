import {argosScreenshot} from '@argos-ci/storybook/vitest';
import type {Meta, StoryObj} from '@storybook/react';
import {screen, within} from '@testing-library/react';
import type {UserEvent} from '@testing-library/user-event';
import userEvent from '@testing-library/user-event';
import {useState} from 'react';
import {Avatar} from '../avatar';
import {Button} from '../button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './dropdown-menu';

const OPEN_MENU_REGEX = /open menu/i;
const ACTIONS_REGEX = /actions/i;
const ORGANIZATION_REGEX = /organization/i;
const COMPLETE_MENU_REGEX = /complete menu/i;
const SWITCH_ORGANIZATION_REGEX = /switch organization/i;

const isTestEnvironment = () => typeof navigator !== 'undefined' && navigator.webdriver === true;

type StoryContext = Parameters<NonNullable<Story['play']>>[0];
type AdditionalStepsCallback = (ctx: StoryContext, user: UserEvent) => Promise<void>;

async function openMenuAndScreenshot(
  ctx: StoryContext,
  triggerRegex: RegExp,
  screenshotName: string,
  additionalSteps?: AdditionalStepsCallback,
): Promise<void> {
  const {canvasElement, step} = ctx;
  const canvas = within(canvasElement);
  const user = userEvent.setup();

  let triggerButton: HTMLElement | null = null;

  await step('Open the dropdown menu', async () => {
    triggerButton = canvas.getByRole('button', {name: triggerRegex});
    await user.click(triggerButton);
  });

  await step('Wait for menu to appear and render', async () => {
    await screen.findByRole('menu');
    await new Promise((resolve) => setTimeout(resolve, 300));

    if (isTestEnvironment() && triggerButton instanceof HTMLElement) {
      triggerButton.style.display = 'none';
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  await argosScreenshot(ctx, screenshotName);

  if (additionalSteps) {
    await additionalSteps(ctx, user);
  }
}

const meta = {
  title: 'Components/DropdownMenu',
  component: DropdownMenuContent,
  subcomponents: {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuItem,
    DropdownMenuCheckboxItem,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuGroup,
    DropdownMenuSub,
    DropdownMenuSubTrigger,
    DropdownMenuSubContent,
  },
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    side: {
      control: 'select',
      options: ['top', 'right', 'bottom', 'left'],
      description: 'The preferred side of the trigger to render against',
      table: {defaultValue: {summary: 'bottom'}},
    },
    align: {
      control: 'select',
      options: ['start', 'center', 'end'],
      description: 'The preferred alignment against the trigger',
      table: {defaultValue: {summary: 'start'}},
    },
    sideOffset: {
      control: {type: 'number', min: 0, max: 20, step: 1},
      description: 'Distance in pixels from the trigger',
      table: {defaultValue: {summary: '4'}},
    },
    alignOffset: {
      control: {type: 'number', min: -20, max: 20, step: 1},
      description: 'Offset in pixels from the alignment edge',
      table: {defaultValue: {summary: '0'}},
    },
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg'],
      description: 'Size variant of the dropdown content',
      table: {defaultValue: {summary: 'md'}},
    },
  },
  args: {
    side: 'bottom',
    align: 'center',
    sideOffset: 8,
    alignOffset: 0,
    size: 'md',
  },
} satisfies Meta<typeof DropdownMenuContent>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: (ctx) => openMenuAndScreenshot(ctx, OPEN_MENU_REGEX, 'DropdownMenu Default Open'),
  render: function DefaultStory(args) {
    const [container, setContainer] = useState<HTMLDivElement | null>(null);

    return (
      <div
        ref={setContainer}
        className="relative flex h-500 w-500 items-center justify-center rounded-16 bg-background-subtle-base shadow-tooltip overflow-visible"
      >
        {container && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary">Open Menu</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent {...args} container={container} side="bottom" align="center">
              <DropdownMenuItem icon="editLine">Edit</DropdownMenuItem>
              <DropdownMenuItem icon="addLine">Add</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem icon="deleteBinLine">Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    );
  },
};

export const WithShortcuts: Story = {
  play: (ctx) => openMenuAndScreenshot(ctx, ACTIONS_REGEX, 'DropdownMenu With Shortcuts Open'),
  render: function WithShortcutsStory(args) {
    const [container, setContainer] = useState<HTMLDivElement | null>(null);

    return (
      <div
        ref={setContainer}
        className="relative flex h-500 w-500 items-center justify-center rounded-16 bg-background-subtle-base shadow-tooltip overflow-visible"
      >
        {container && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary">Actions</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent {...args} container={container} side="bottom" align="center">
              <DropdownMenuItem icon="fileCopyLine" shortcut="⌘C">
                Copy
              </DropdownMenuItem>
              <DropdownMenuItem icon="clipboardLine" shortcut="⌘V">
                Paste
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem icon="deleteBinLine" shortcut="⌘⌫">
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    );
  },
};

function UserProfileSection() {
  return (
    <div className="flex items-center gap-8 px-8 py-6">
      <Avatar
        size="sm"
        content="image"
        src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop&crop=faces"
        fallback="John Doe"
      />
      <div className="flex flex-col">
        <span className="text-sm font-medium leading-20 text-foreground-neutral-base">
          John Doe
        </span>
        <span className="text-xs leading-16 text-foreground-neutral-muted">john@example.com</span>
      </div>
    </div>
  );
}

function OrganizationItem() {
  return (
    <div className="flex items-center gap-8 px-8 py-6">
      <Avatar size="3xs" content="logo" logoName="stripe" radius="rounded" />
      <span className="text-sm leading-20 text-foreground-neutral-subtle">
        Stripe&apos;s organization
      </span>
    </div>
  );
}

export const OrganizationMenu: Story = {
  args: {
    size: 'md',
  },
  play: (ctx) =>
    openMenuAndScreenshot(
      ctx,
      ORGANIZATION_REGEX,
      'DropdownMenu Organization Menu Open',
      async ({step}, user) => {
        await step('Hover over submenu trigger', async () => {
          const submenuTrigger = screen.getByRole('menuitem', {name: SWITCH_ORGANIZATION_REGEX});
          await user.hover(submenuTrigger);
          await new Promise((resolve) => setTimeout(resolve, 200));
        });

        await argosScreenshot(ctx, 'DropdownMenu Organization Menu Submenu Open');
      },
    ),
  render: function OrganizationMenuStory(args) {
    const [container, setContainer] = useState<HTMLDivElement | null>(null);

    return (
      <div
        ref={setContainer}
        className="relative flex h-600 w-600 items-center justify-center rounded-16 bg-background-subtle-base shadow-tooltip overflow-visible"
      >
        {container && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" iconLeft="buildingLine">
                Organization
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent {...args} container={container} side="bottom" align="start">
              <OrganizationItem />
              <DropdownMenuSeparator />
              <DropdownMenuItem icon="settings3Line">Settings</DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger icon="arrowLeftRightLine">
                  Switch organization
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem
                    icon="shipfox"
                    iconStyle="text-foreground-neutral-base"
                    className="text-foreground-neutral-base"
                  >
                    Shipfox
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    icon="github"
                    iconStyle="text-foreground-neutral-base"
                    className="text-foreground-neutral-base"
                  >
                    Github
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    icon="google"
                    iconStyle="text-foreground-neutral-base"
                    className="text-foreground-neutral-base"
                  >
                    Google
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem icon="addLine">New organization</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    );
  },
};

export const CompleteExample: Story = {
  args: {
    size: 'lg',
    side: 'bottom',
  },
  play: (ctx) =>
    openMenuAndScreenshot(ctx, COMPLETE_MENU_REGEX, 'DropdownMenu Complete Example Open'),
  render: function CompleteExampleStory(args) {
    const [container, setContainer] = useState<HTMLDivElement | null>(null);
    const [showNotifications, setShowNotifications] = useState(true);
    const [showBadges, setShowBadges] = useState(false);
    const [theme, setTheme] = useState('dark');

    return (
      <div
        ref={setContainer}
        className="relative flex h-600 w-500 items-center justify-center rounded-16 bg-background-subtle-base shadow-tooltip overflow-visible"
      >
        {container && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" iconLeft="menu3Line">
                Complete Menu
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              {...args}
              className="w-260"
              container={container}
              side="bottom"
              align="start"
            >
              <UserProfileSection />
              <DropdownMenuSeparator />

              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuGroup>
                <DropdownMenuItem icon="sparklingLine">Getting started</DropdownMenuItem>
                <DropdownMenuItem icon="userLine">Profile settings</DropdownMenuItem>
              </DropdownMenuGroup>

              <DropdownMenuSeparator />

              <DropdownMenuLabel>Preferences</DropdownMenuLabel>
              <DropdownMenuGroup>
                <DropdownMenuCheckboxItem
                  checked={showNotifications}
                  onCheckedChange={setShowNotifications}
                  closeOnSelect={false}
                >
                  Show notifications
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={showBadges}
                  onCheckedChange={setShowBadges}
                  closeOnSelect={false}
                >
                  Show badges
                </DropdownMenuCheckboxItem>
              </DropdownMenuGroup>

              <DropdownMenuSeparator />

              <DropdownMenuLabel>Theme</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
                <DropdownMenuRadioItem value="light" closeOnSelect={false}>
                  Light
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="dark" closeOnSelect={false}>
                  Dark
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="system" closeOnSelect={false}>
                  System
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>

              <DropdownMenuSeparator />
              <DropdownMenuItem icon="logoutCircleLine">Log out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    );
  },
};
