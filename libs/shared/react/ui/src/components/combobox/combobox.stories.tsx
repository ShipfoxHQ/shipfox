import type {Meta, StoryObj} from '@storybook/react';
import {useState} from 'react';
import {expect, screen, userEvent, within} from 'storybook/test';
import {Label} from '../label/index.js';
import {Combobox} from './combobox.js';
import {ComboboxContent, ComboboxList} from './combobox-content.js';
import {ComboboxRoot} from './combobox-root.js';
import type {ComboboxOption} from './combobox-state.js';
import {ComboboxTrigger} from './combobox-trigger.js';

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

const repositoriesLabel = /repositories/i;
const emptyStateSupportText = /Repository list is limited to 100/i;

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
    .map((match) => match.closest('[role="option"]'))
    .find((match): match is HTMLElement => match instanceof HTMLElement);

  if (!item) {
    throw new Error(`Command option not found: ${label}`);
  }

  await user.click(item);
}

export const Playground: Story = {
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

const overflowValues = [
  'apache',
  'apache-superset',
  'release-production-multi-region-canary',
  'apollo',
  'apify',
];

export const ChipVariants: Story = {
  args: {} as never,
  render: () => {
    const [growingValue, setGrowingValue] = useState<string[]>(overflowValues);
    const [compactValue, setCompactValue] = useState<string[]>(overflowValues);

    return (
      <div className="flex flex-col gap-20">
        <div className="w-280">
          <Label htmlFor="combobox-growing">Growing (default)</Label>
          <Combobox
            id="combobox-growing"
            multiple
            options={sampleItems}
            value={growingValue}
            onValueChange={setGrowingValue}
            placeholder="Select repositories..."
            searchPlaceholder="Search repositories..."
          />
        </div>
        <div className="w-280">
          <Label htmlFor="combobox-compact">Compact (maxVisibleChips=2)</Label>
          <Combobox
            id="combobox-compact"
            multiple
            options={sampleItems}
            value={compactValue}
            onValueChange={setCompactValue}
            maxVisibleChips={2}
            placeholder="Select repositories..."
            searchPlaceholder="Search repositories..."
          />
        </div>
      </div>
    );
  },
};

export const States: Story = {
  args: {} as never,
  render: () => {
    const [loadingValue, setLoadingValue] = useState('');
    const [disabledValue, setDisabledValue] = useState<string[]>(['apache', 'apollo']);

    return (
      <div className="flex flex-col gap-20">
        <div className="w-[80vw] md:w-500">
          <Label htmlFor="combobox-loading">Loading</Label>
          <Combobox
            id="combobox-loading"
            options={sampleItems}
            value={loadingValue}
            onValueChange={setLoadingValue}
            placeholder="Type to search..."
            searchPlaceholder="Search repositories..."
            isLoading
          />
        </div>
        <div className="w-[80vw] md:w-500">
          <Label htmlFor="combobox-disabled">Disabled</Label>
          <Combobox
            id="combobox-disabled"
            multiple
            options={sampleItems}
            value={disabledValue}
            onValueChange={setDisabledValue}
            maxVisibleChips={2}
            disabled
            placeholder="Disabled input"
            searchPlaceholder="Search repositories..."
            emptyState="No results found"
          />
        </div>
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
            <ComboboxList emptyState="No repositories match." />
          </ComboboxContent>
        </ComboboxRoot>
      </div>
    );
  },
};

export const TestMultiSelect: Story = {
  args: {} as never,
  play: async ({canvasElement, step}) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup();

    await step('Combobox is reachable by its visible label', async () => {
      await expect(canvas.getByRole('combobox', {name: repositoriesLabel})).toBeInTheDocument();
    });

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

export const TestClearAllAndBackspace: Story = {
  args: {} as never,
  play: async ({canvasElement, step}) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup();

    await step('Clear every selected value', async () => {
      await user.click(canvas.getByLabelText('Clear selected options'));
      await canvas.findByPlaceholderText('Select repositories...');
    });

    await step('Backspace removes the last chip only when the search is empty', async () => {
      await user.click(canvas.getByRole('combobox'));
      await clickCommandOption(user, 'apache');
      await clickCommandOption(user, 'apollo');

      const combobox = canvas.getByRole('combobox');
      await user.type(combobox, 'x');
      await user.keyboard('{Backspace}');
      await canvas.findByLabelText('Remove apache');
      await canvas.findByLabelText('Remove apollo');

      await user.keyboard('{Backspace}');
      await canvas.findByLabelText('Remove apache');
      await expect(canvas.queryByLabelText('Remove apollo')).toBeNull();
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

export const TestTypeToFilterMulti: Story = {
  args: {} as never,
  play: async ({canvasElement, step}) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup();
    const combobox = canvas.getByRole('combobox', {name: repositoriesLabel});

    await step('Spaces are typed into the search, not swallowed', async () => {
      await user.click(combobox);
      await user.type(combobox, 'a b');
      await expect(combobox).toHaveValue('a b');
    });

    await step('Typing narrows the list and a match can be selected', async () => {
      await user.clear(combobox);
      await user.type(combobox, 'apify');
      await clickCommandOption(user, 'apify');
      await canvas.findByLabelText('Remove apify');
      await expect(combobox).toHaveFocus();
    });
  },
  render: () => {
    const [value, setValue] = useState<string[]>([]);

    return (
      <div className="w-[80vw] md:w-500">
        <Label htmlFor="combobox-type-filter">Repositories</Label>
        <Combobox
          id="combobox-type-filter"
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

export const TestUncontrolledMulti: Story = {
  args: {} as never,
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup();

    await canvas.findByLabelText('Remove apache');
    await user.click(canvas.getByRole('combobox'));
    await clickCommandOption(user, 'apollo');
    await canvas.findByLabelText('Remove apollo');
    await canvas.findByLabelText('Remove apache');
  },
  render: () => (
    <div className="w-[80vw] md:w-500">
      <Label htmlFor="combobox-uncontrolled">Repositories</Label>
      <Combobox
        id="combobox-uncontrolled"
        multiple
        defaultValue={['apache']}
        options={sampleItems}
        maxVisibleChips={2}
        placeholder="Select repositories..."
        searchPlaceholder="Search repositories..."
      />
    </div>
  ),
};

export const TestKeyboardNavMulti: Story = {
  args: {} as never,
  play: async ({canvasElement, step}) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup();
    const combobox = canvas.getByRole('combobox', {name: repositoriesLabel});

    await step('Arrow down then Enter selects the highlighted option', async () => {
      await user.click(combobox);
      await user.keyboard('{ArrowDown}{Enter}');
      await canvas.findByLabelText('Remove apache-superset');
    });

    await step('Arrow up then Enter selects the previous option, popup stays open', async () => {
      await user.keyboard('{ArrowUp}{Enter}');
      await canvas.findByLabelText('Remove apache');
    });
  },
  render: () => {
    const [value, setValue] = useState<string[]>([]);

    return (
      <div className="w-[80vw] md:w-500">
        <Label htmlFor="combobox-keyboard">Repositories</Label>
        <Combobox
          id="combobox-keyboard"
          multiple
          options={sampleItems}
          value={value}
          onValueChange={setValue}
          maxVisibleChips={3}
          placeholder="Select repositories..."
          searchPlaceholder="Search repositories..."
        />
      </div>
    );
  },
};

export const TestKeyboardNavSingle: Story = {
  args: {} as never,
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup();

    await user.click(canvas.getByLabelText('Repository'));
    const combobox = await screen.findByRole('combobox');
    await user.type(combobox, 'apoll');
    await user.keyboard('{Enter}');

    await canvas.findByText('apollo');
  },
  render: () => {
    const [value, setValue] = useState('');

    return (
      <div className="w-[80vw] md:w-500">
        <Label htmlFor="combobox-single-kbd">Repository</Label>
        <Combobox
          id="combobox-single-kbd"
          options={sampleItems}
          value={value}
          onValueChange={setValue}
          placeholder="Select a repository..."
          searchPlaceholder="Search repositories..."
        />
      </div>
    );
  },
};

export const TestEmptyState: Story = {
  args: {} as never,
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup();

    await user.click(canvas.getByText('abcxyz'));
    await screen.findByText(emptyStateSupportText);
  },
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
