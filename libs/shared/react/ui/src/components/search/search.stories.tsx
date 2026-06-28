import type {Meta, StoryObj} from '@storybook/react';
import {useState} from 'react';
import {Icon} from '../icon/index.js';
import {
  Search,
  SearchContent,
  SearchEmpty,
  SearchFooter,
  SearchGroup,
  SearchInline,
  SearchInput,
  SearchItem,
  SearchList,
  SearchSeparator,
  SearchTrigger,
} from './index.js';

const meta: Meta = {
  title: 'Components/Search',
  tags: ['autodocs'],
};

export default meta;

type Story = StoryObj;

export const Inline: Story = {
  render: () => {
    function InlineDemo() {
      const [value, setValue] = useState('');

      return (
        <div className="flex max-w-400 flex-col gap-16">
          <SearchInline
            placeholder="Search..."
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onClear={() => setValue('')}
          />
          {value && <p className="text-sm text-foreground-neutral-muted">Searching for: {value}</p>}
        </div>
      );
    }

    return <InlineDemo />;
  },
};

export const InlineVariants: Story = {
  render: () => (
    <div className="flex flex-col gap-16">
      <div className="flex flex-col gap-8">
        <span className="text-xs text-foreground-neutral-muted">Primary</span>
        <div className="flex gap-8">
          <SearchInline
            variant="primary"
            radius="squared"
            placeholder="Search..."
            className="w-200"
          />
          <SearchInline
            variant="primary"
            radius="rounded"
            placeholder="Search..."
            className="w-200"
          />
        </div>
      </div>
      <div className="flex flex-col gap-8">
        <span className="text-xs text-foreground-neutral-muted">Secondary</span>
        <div className="flex gap-8">
          <SearchInline
            variant="secondary"
            radius="squared"
            placeholder="Search..."
            className="w-200"
          />
          <SearchInline
            variant="secondary"
            radius="rounded"
            placeholder="Search..."
            className="w-200"
          />
        </div>
      </div>
    </div>
  ),
};

export const InlineSizes: Story = {
  render: () => (
    <div className="flex flex-col gap-16">
      <SearchInline size="base" placeholder="Search..." className="w-200" />
      <SearchInline size="small" placeholder="Search..." className="w-200" />
    </div>
  ),
};

function ModalSearchDemo() {
  const [open, setOpen] = useState(false);

  return (
    <Search open={open} onOpenChange={setOpen} shortcutKey="meta+k">
      <SearchTrigger placeholder="Find..." className="w-full max-w-280" />
      <SearchContent aria-describedby={undefined}>
        <SearchInput placeholder="Search for anything..." />
        <SearchList>
          <SearchEmpty>No results found.</SearchEmpty>
          <SearchGroup heading="Recent">
            <SearchItem
              icon={
                <Icon name="gitBranchLine" className="size-16 text-foreground-neutral-subtle" />
              }
              description="workflow-platform"
            >
              feat/data-processing
            </SearchItem>
            <SearchItem
              icon={
                <Icon name="gitBranchLine" className="size-16 text-foreground-neutral-subtle" />
              }
              description="workflow-platform"
            >
              fix/retry-window
            </SearchItem>
          </SearchGroup>
          <SearchSeparator />
          <SearchGroup heading="Team">
            <SearchItem
              icon={<Icon name="rocketLine" className="size-16 text-foreground-neutral-subtle" />}
              description="Team"
            >
              Deployments
            </SearchItem>
            <SearchItem
              icon={<Icon name="linksLine" className="size-16 text-foreground-neutral-subtle" />}
              description="Team"
            >
              Integrations
            </SearchItem>
          </SearchGroup>
        </SearchList>
        <SearchFooter />
      </SearchContent>
    </Search>
  );
}

export const Modal: Story = {
  render: () => <ModalSearchDemo />,
};

function TriggerPreview({
  variant,
  size,
  radius,
  className,
}: {
  variant?: 'primary' | 'secondary';
  size?: 'base' | 'small';
  radius?: 'squared' | 'rounded';
  className?: string;
}) {
  return (
    <Search>
      <SearchTrigger variant={variant} size={size} radius={radius} className={className} />
    </Search>
  );
}

export const ModalTriggerVariants: Story = {
  render: () => (
    <div className="flex flex-col gap-16">
      <div className="flex flex-col gap-8">
        <span className="text-xs text-foreground-neutral-muted">Primary</span>
        <div className="flex gap-8">
          <TriggerPreview variant="primary" radius="squared" className="w-200" />
          <TriggerPreview variant="primary" radius="rounded" className="w-200" />
        </div>
      </div>
      <div className="flex flex-col gap-8">
        <span className="text-xs text-foreground-neutral-muted">Secondary</span>
        <div className="flex gap-8">
          <TriggerPreview variant="secondary" radius="squared" className="w-200" />
          <TriggerPreview variant="secondary" radius="rounded" className="w-200" />
        </div>
      </div>
    </div>
  ),
};

export const ModalTriggerSizes: Story = {
  render: () => (
    <div className="flex flex-col gap-16">
      <TriggerPreview size="base" variant="primary" className="w-200" />
      <TriggerPreview size="small" variant="primary" className="w-200" />
      <TriggerPreview size="base" variant="secondary" className="w-200" />
      <TriggerPreview size="small" variant="secondary" className="w-200" />
    </div>
  ),
};
