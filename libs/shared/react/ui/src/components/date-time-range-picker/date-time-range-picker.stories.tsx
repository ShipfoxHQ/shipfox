import type {Meta, StoryObj} from '@storybook/react';
import type {ComponentProps} from 'react';
import {useState} from 'react';
import {Icon} from '#components/icon/index.js';
import {Label} from '#components/label/index.js';
import {type DateRange, DateTimeRangePicker} from './date-time-range-picker.js';

const seededRange: DateRange = {
  start: new Date(2024, 0, 8),
  end: new Date(2024, 0, 15),
};

const meta = {
  title: 'Components/DateTimeRangePicker',
  component: DateTimeRangePicker,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['base', 'component'],
    },
    size: {
      control: 'select',
      options: ['base', 'small'],
    },
    state: {
      control: 'select',
      options: ['default', 'error', 'disabled'],
    },
  },
  args: {
    variant: 'base',
    size: 'base',
    state: 'default',
  },
} satisfies Meta<typeof DateTimeRangePicker>;

export default meta;

type Story = StoryObj<typeof meta>;

function ControlledPicker({
  initialRange,
  ...props
}: {initialRange?: DateRange} & Omit<
  ComponentProps<typeof DateTimeRangePicker>,
  'dateRange' | 'onDateRangeSelect' | 'onClear'
>) {
  const [range, setRange] = useState<DateRange | undefined>(initialRange);
  return (
    <DateTimeRangePicker
      {...props}
      dateRange={range}
      onDateRangeSelect={setRange}
      onClear={() => setRange(undefined)}
    />
  );
}

export const Default: Story = {
  render: (args) => <ControlledPicker {...args} />,
};

export const WithSelectedRange: Story = {
  render: (args) => <ControlledPicker {...args} initialRange={seededRange} />,
};

export const Sizes: Story = {
  render: (args) => (
    <div className="flex flex-col gap-12">
      <ControlledPicker {...args} size="base" initialRange={seededRange} />
      <ControlledPicker {...args} size="small" initialRange={seededRange} />
    </div>
  ),
};

export const Variants: Story = {
  render: (args) => (
    <div className="flex flex-col gap-12">
      <ControlledPicker {...args} variant="base" initialRange={seededRange} />
      <ControlledPicker {...args} variant="component" initialRange={seededRange} />
    </div>
  ),
};

export const States: Story = {
  render: (args) => (
    <div className="flex flex-col gap-16">
      <div className="grid gap-8">
        <Label htmlFor="default-picker">Default</Label>
        <ControlledPicker {...args} id="default-picker" />
      </div>
      <div className="grid gap-8">
        <Label htmlFor="error-picker">Error</Label>
        <ControlledPicker {...args} id="error-picker" state="error" initialRange={seededRange} />
      </div>
      <div className="grid gap-8">
        <Label htmlFor="disabled-picker">Disabled</Label>
        <ControlledPicker
          {...args}
          id="disabled-picker"
          state="disabled"
          initialRange={seededRange}
        />
      </div>
    </div>
  ),
};

export const WithRightIcon: Story = {
  render: (args) => (
    <ControlledPicker
      {...args}
      rightIcon={<Icon name="arrowDownSLine" className="size-16 text-foreground-neutral-muted" />}
    />
  ),
};

export const LimitedRange: Story = {
  render: (args) => <ControlledPicker {...args} maxRangeDays={7} closeOnSelect />,
};
