import type {Meta, StoryObj} from '@storybook/react';
import {useState} from 'react';
import {expect, screen, userEvent, within} from 'storybook/test';
import {Label} from '../label/index.js';
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxList,
  type ComboboxOption,
  ComboboxRoot,
  ComboboxTrigger,
} from './combobox.js';

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
  {
    value: 'release-production-multi-region-canary',
    label: 'release-production-multi-region-canary',
  },
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

async function clickCommandOption(user: ReturnType<typeof userEvent.setup>, label: string) {
  const matches = await screen.findAllByText(label);
  const item = matches
    .map((match) => match.closest('[cmdk-item]'))
    .find((match): match is HTMLElement => match instanceof HTMLElement);

  if (!item) {
    throw new Error(`Command option not found: ${label}`);
  }

  await user.click(item);
}

export const Default: Story = {
  args: {} as never,
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText('Type to search...')).toBeVisible();
  },
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

export const MultiSelect: Story = {
  args: {} as never,
  play: async ({canvasElement, step}) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup();

    await step('Select two repositories', async () => {
      await user.click(canvas.getByRole('combobox'));
      await clickCommandOption(user, 'apache');
      await clickCommandOption(user, 'apollo');
      await within(canvasElement).findByLabelText('Remove apache');
      await within(canvasElement).findByLabelText('Remove apollo');
    });

    await step('Toggle one selected repository off', async () => {
      await clickCommandOption(user, 'apache');
      await canvas.findByLabelText('Remove apollo');
    });

    await step('Remove a chip', async () => {
      await user.click(canvas.getByLabelText('Remove apollo'));
    });
  },
  render: () => {
    const [value, setValue] = useState<string[]>([]);

    return (
      <div className="w-[80vw] md:w-500">
        <Label htmlFor="combobox-multi">Repositories</Label>
        <Combobox
          id="combobox-multi"
          multiple
          options={sampleItems}
          value={value}
          onValueChange={setValue}
          maxVisibleChips={2}
          placeholder="Select repositories..."
          searchPlaceholder="Search repositories..."
          emptyState="No repository found."
        />
      </div>
    );
  },
};

export const PrimitiveComposition: Story = {
  args: {} as never,
  render: () => {
    const [value, setValue] = useState<string[]>(['apache', 'apollo']);

    return (
      <div className="w-[80vw] md:w-500">
        <Label htmlFor="combobox-primitives">Primitive composition</Label>
        <ComboboxRoot
          multiple
          options={sampleItems}
          value={value}
          onValueChange={setValue}
          maxVisibleChips={2}
        >
          <ComboboxTrigger id="combobox-primitives" placeholder="Pick repositories..." />
          <ComboboxContent>
            <ComboboxInput placeholder="Search repositories..." />
            <ComboboxList emptyState="No repositories match." />
          </ComboboxContent>
        </ComboboxRoot>
      </div>
    );
  },
};

export const MeasuredOverflow: Story = {
  args: {} as never,
  play: async ({canvasElement, step}) => {
    const canvas = within(canvasElement);

    await step('Summarize overflowed chips', async () => {
      await canvas.findByLabelText('3 more selected');
    });
  },
  render: () => {
    const [value, setValue] = useState<string[]>([
      'apache',
      'apache-superset',
      'release-production-multi-region-canary',
      'apollo',
      'apify',
    ]);

    return (
      <div className="w-280">
        <Label htmlFor="combobox-overflow">Measured overflow</Label>
        <Combobox
          id="combobox-overflow"
          multiple
          options={sampleItems}
          value={value}
          onValueChange={setValue}
          placeholder="Select repositories..."
          searchPlaceholder="Search repositories..."
        />
      </div>
    );
  },
};

export const ClearAllAndBackspace: Story = {
  args: {} as never,
  play: async ({canvasElement, step}) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup();

    await step('Clear every selected value', async () => {
      await user.click(canvas.getByLabelText('Clear selected options'));
      await canvas.findByPlaceholderText('Select repositories...');
    });

    await step('Backspace removes the last chip', async () => {
      await user.click(canvas.getByRole('combobox'));
      await clickCommandOption(user, 'apache');
      await clickCommandOption(user, 'apollo');
      await user.click(canvas.getByRole('textbox'));
      await user.keyboard('{Backspace}');
      await canvas.findByLabelText('Remove apache');
    });
  },
  render: () => {
    const [value, setValue] = useState<string[]>(['apache', 'apollo']);

    return (
      <div className="w-[80vw] md:w-500">
        <Label htmlFor="combobox-clear">Clear and backspace</Label>
        <Combobox
          id="combobox-clear"
          multiple
          options={sampleItems}
          value={value}
          onValueChange={setValue}
          maxVisibleChips={2}
          placeholder="Select repositories..."
          searchPlaceholder="Search repositories..."
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
    const [value, setValue] = useState<string[]>(['apache', 'apollo']);

    return (
      <div className="w-[80vw] md:w-500">
        <Label htmlFor="combobox-disabled">Disabled</Label>
        <Combobox
          id="combobox-disabled"
          multiple
          options={sampleItems}
          value={value}
          onValueChange={setValue}
          maxVisibleChips={2}
          disabled
          placeholder="Disabled input"
          searchPlaceholder="Search repositories..."
          emptyState="No results found"
        />
      </div>
    );
  },
};
