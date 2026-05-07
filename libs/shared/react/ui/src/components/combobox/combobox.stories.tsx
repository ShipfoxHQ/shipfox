import type {Meta, StoryObj} from '@storybook/react';
import {useState} from 'react';
import {Label} from '../label/index.js';
import {Combobox, type ComboboxOption} from './combobox';

const sampleItems: ComboboxOption[] = [
  {value: 'apache', label: 'apache'},
  {value: 'apache-superset', label: 'apache-superset'},
  {value: 'apaleo', label: 'apaleo'},
  {value: 'apollo', label: 'apollo'},
  {value: 'apple', label: 'apple'},
  {value: 'apache-kafka', label: 'apache-kafka'},
  {value: 'apex', label: 'apex'},
  {value: 'appsmith', label: 'appsmith'},
  {value: 'applitools', label: 'applitools'},
  {value: 'approzium', label: 'approzium'},
  {value: 'apify', label: 'apify'},
  {value: 'apicurio', label: 'apicurio'},
  {value: 'apitable', label: 'apitable'},
  {value: 'apollographql', label: 'apollographql'},
  {value: 'aptos', label: 'aptos'},
];

const meta = {
  title: 'Components/Combobox',
  component: Combobox,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
  },
} satisfies Meta<typeof Combobox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {} as never,
  render: () => {
    const [value, setValue] = useState('');

    return (
      <div className="w-[80vw] md:w-500">
        <Label htmlFor="combobox-default">Search repositories</Label>
        <Combobox
          id="combobox-default"
          options={sampleItems}
          value={value}
          onValueChange={setValue}
          placeholder="Type to search..."
          searchPlaceholder="Search repositories..."
          emptyState="No repository found."
        />
      </div>
    );
  },
};

export const EmptyState: Story = {
  args: {} as never,
  render: () => {
    const [value, setValue] = useState('abcxyz');

    return (
      <div className="w-[80vw] md:w-500">
        <Label htmlFor="combobox-empty">No results</Label>
        <Combobox
          id="combobox-empty"
          options={[]}
          value={value}
          onValueChange={setValue}
          placeholder="Type to search..."
          searchPlaceholder="Search repositories..."
          emptyState={
            <p className="px-4 whitespace-pre-wrap">
              Repository list is limited to 100.{' '}
              <a
                href="https://support.example.com"
                target="_blank"
                rel="noopener noreferrer"
                className="underline text-foreground-neutral-base"
              >
                Contact us
              </a>{' '}
              for support.
            </p>
          }
        />
      </div>
    );
  },
};

export const LoadingState: Story = {
  args: {} as never,
  render: () => {
    const [value, setValue] = useState('');
    return (
      <div className="w-[80vw] md:w-500">
        <Label htmlFor="combobox-loading">Loading</Label>
        <Combobox
          id="combobox-loading"
          options={sampleItems}
          value={value}
          onValueChange={setValue}
          placeholder="Type to search..."
          searchPlaceholder="Search repositories..."
          isLoading
        />
      </div>
    );
  },
};

export const DisabledState: Story = {
  args: {} as never,
  render: () => {
    const [value, setValue] = useState('apache');

    return (
      <div className="w-[80vw] md:w-500">
        <Label htmlFor="combobox-disabled">Disabled</Label>
        <Combobox
          id="combobox-disabled"
          options={sampleItems}
          value={value}
          onValueChange={setValue}
          disabled
          placeholder="Disabled input"
          searchPlaceholder="Search repositories..."
          emptyState="No results found"
        />
      </div>
    );
  },
};
