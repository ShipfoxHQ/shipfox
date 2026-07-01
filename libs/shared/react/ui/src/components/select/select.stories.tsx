import type {Meta, StoryObj} from '@storybook/react';
import {Kbd} from '../kbd/index.js';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from './select.js';

const meta = {
  title: 'Components/Select',
  component: Select,
  tags: ['autodocs'],
} satisfies Meta<typeof Select>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: () => (
    <Select>
      <SelectTrigger className="w-200">
        <SelectValue placeholder="Select an option" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="option1">Option 1</SelectItem>
        <SelectItem value="option2">Option 2</SelectItem>
        <SelectItem value="option3">Option 3</SelectItem>
      </SelectContent>
    </Select>
  ),
};

export const WithGroups: Story = {
  render: () => (
    <Select defaultValue="typescript">
      <SelectTrigger className="w-280">
        <SelectValue placeholder="Select a technology" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Frontend</SelectLabel>
          <SelectItem value="react">React</SelectItem>
          <SelectItem value="vue">Vue</SelectItem>
          <SelectItem value="angular">Angular</SelectItem>
          <SelectItem value="svelte">Svelte</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>Backend</SelectLabel>
          <SelectItem value="nodejs">Node.js</SelectItem>
          <SelectItem value="python">Python</SelectItem>
          <SelectItem value="ruby">Ruby</SelectItem>
          <SelectItem value="go">Go</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>Languages</SelectLabel>
          <SelectItem value="typescript">TypeScript</SelectItem>
          <SelectItem value="javascript">JavaScript</SelectItem>
          <SelectItem value="rust">Rust</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  ),
};

export const WithIcons: Story = {
  render: () => (
    <div className="flex flex-col gap-12">
      <Select defaultValue="active">
        <SelectTrigger className="w-200">
          <SelectValue placeholder="Select status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="active" icon="checkboxCircleLine">
            Active
          </SelectItem>
          <SelectItem value="pending" icon="timeLine">
            Pending
          </SelectItem>
          <SelectItem value="inactive" icon="closeLine">
            Inactive
          </SelectItem>
        </SelectContent>
      </Select>

      <Select defaultValue="medium">
        <SelectTrigger className="w-200">
          <SelectValue placeholder="Select priority" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="high" icon="arrowUpLine">
            High
          </SelectItem>
          <SelectItem value="medium" icon="equalLine">
            Medium
          </SelectItem>
          <SelectItem value="low" icon="arrowDownLine">
            Low
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div className="flex flex-col gap-12">
      <Select>
        <SelectTrigger size="small" className="w-200">
          <SelectValue placeholder="Small" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="option1">Option 1</SelectItem>
          <SelectItem value="option2">Option 2</SelectItem>
        </SelectContent>
      </Select>

      <Select>
        <SelectTrigger size="base" className="w-200">
          <SelectValue placeholder="Base (default)" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="option1">Option 1</SelectItem>
          <SelectItem value="option2">Option 2</SelectItem>
        </SelectContent>
      </Select>
    </div>
  ),
};

export const Variants: Story = {
  render: () => (
    <div className="flex flex-col gap-12">
      <Select>
        <SelectTrigger variant="base" className="w-200">
          <SelectValue placeholder="Base variant" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="option1">Option 1</SelectItem>
          <SelectItem value="option2">Option 2</SelectItem>
        </SelectContent>
      </Select>

      <Select>
        <SelectTrigger variant="component" className="w-200">
          <SelectValue placeholder="Component variant" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="option1">Option 1</SelectItem>
          <SelectItem value="option2">Option 2</SelectItem>
        </SelectContent>
      </Select>
    </div>
  ),
};

export const TimeSelector: Story = {
  render: () => (
    <Select defaultValue="2days">
      <SelectTrigger className="w-280">
        <div className="flex items-center gap-8 flex-1 min-w-0">
          <SelectValue placeholder="Select time range" />
        </div>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="1hour">
          <div className="flex items-center gap-8">
            <Kbd className="h-16">1h</Kbd>
            <span>Past 1 Hour</span>
          </div>
        </SelectItem>
        <SelectItem value="1day">
          <div className="flex items-center gap-8">
            <Kbd className="h-16">1d</Kbd>
            <span>Past 1 Day</span>
          </div>
        </SelectItem>
        <SelectItem value="2days">
          <div className="flex items-center gap-8">
            <Kbd className="h-16">2d</Kbd>
            <span>Past 2 Days</span>
          </div>
        </SelectItem>
        <SelectItem value="7days">
          <div className="flex items-center gap-8">
            <Kbd className="h-16">7d</Kbd>
            <span>Past 7 Days</span>
          </div>
        </SelectItem>
        <SelectItem value="30days">
          <div className="flex items-center gap-8">
            <Kbd className="h-16">30d</Kbd>
            <span>Past 30 Days</span>
          </div>
        </SelectItem>
      </SelectContent>
    </Select>
  ),
};
