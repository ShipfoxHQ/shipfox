import type {Meta, StoryObj} from '@storybook/react';
import {waitFor} from 'storybook/test';
import {Code} from '#components/typography/index.js';
import {Badge} from './badge.js';
import {IconBadge} from './icon-badge.js';
import {StatusBadge} from './status-badge.js';
import {UserBadge} from './user-badge.js';

const variants = ['neutral', 'info', 'feature', 'success', 'warning', 'error'] as const;
const iconBadgeVariants = ['neutral', 'info', 'feature', 'success', 'warning', 'error'] as const;
const sizes = ['2xs', 'xs'] as const;
const userBadgeAvatarSrc = `data:image/svg+xml,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="16" fill="#e3e6ea"/>
  <circle cx="16" cy="12" r="6" fill="#6b7280"/>
  <path d="M6 29c1.5-6.2 5.2-9.3 10-9.3S24.5 22.8 26 29" fill="#6b7280"/>
</svg>
`)}`;

const waitForStoryImages = async (canvasElement: HTMLElement) => {
  const images = Array.from(canvasElement.querySelectorAll('img'));

  await waitFor(() => {
    for (const image of images) {
      if (!image.complete || image.naturalWidth === 0) {
        throw new Error('Waiting for badge story images to load');
      }
    }
  });
};

const meta = {
  title: 'Components/Badge',
  component: Badge,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: variants,
    },
    size: {
      control: 'select',
      options: sizes,
    },
    radius: {
      control: 'select',
      options: ['default', 'rounded'],
    },
  },
  args: {
    children: 'Badge',
    variant: 'neutral',
    size: '2xs',
    radius: 'default',
  },
} satisfies Meta<typeof Badge>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-col gap-32">
      <div>
        <Code variant="label" className="mb-16 text-foreground-neutral-subtle">
          Status badge
        </Code>
        <div className="flex gap-16">
          {variants.map((variant) => (
            <StatusBadge key={variant} variant={variant}>
              {variant}
            </StatusBadge>
          ))}
        </div>
      </div>

      <div>
        <Code variant="label" className="mb-16 text-foreground-neutral-subtle">
          Icon badge
        </Code>
        <div className="flex gap-16">
          {iconBadgeVariants.map((variant) => (
            <IconBadge key={variant} variant={variant} name="check" />
          ))}
        </div>
      </div>

      <div>
        <Code variant="label" className="mb-16 text-foreground-neutral-subtle">
          User badge
        </Code>
        <div className="flex gap-16">
          <UserBadge
            name="Ada Lovelace"
            avatarSrc={userBadgeAvatarSrc}
            avatarFallback="Ada Lovelace"
          />
        </div>
      </div>

      {sizes.map((size) => (
        <div key={size}>
          <Code variant="label" className="mb-16 text-foreground-neutral-subtle">
            Badge {size}
          </Code>
          <div className="flex flex-col gap-16">
            <div className="flex gap-16">
              {variants.map((variant) => (
                <Badge key={variant} variant={variant} size={size}>
                  {variant}
                </Badge>
              ))}
            </div>
            <div className="flex gap-16">
              {variants.map((variant) => (
                <Badge key={variant} variant={variant} size={size} iconLeft="check">
                  {variant}
                </Badge>
              ))}
            </div>
            <div className="flex gap-16">
              {variants.map((variant) => (
                <Badge key={variant} variant={variant} size={size} iconRight="close">
                  {variant}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  ),
  play: async ({canvasElement}) => {
    await waitForStoryImages(canvasElement);
  },
};

export const InteractiveBadges: Story = {
  render: () => (
    <div className="flex gap-16">
      <Badge
        variant="info"
        iconRight="close"
        onIconRightClick={() => undefined}
        iconRightAriaLabel="Remove info badge"
      >
        Removable
      </Badge>
      <Badge
        variant="success"
        iconLeft="check"
        iconRight="close"
        onIconLeftClick={() => undefined}
        iconLeftAriaLabel="Confirm"
        onIconRightClick={() => undefined}
        iconRightAriaLabel="Dismiss"
      >
        Actions
      </Badge>
    </div>
  ),
};
