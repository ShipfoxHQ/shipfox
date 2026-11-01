import type {Meta, StoryObj} from '@storybook/react';
import {type ComponentProps, useState} from 'react';
import {expect, userEvent, waitFor, within} from 'storybook/test';
import {Suggestion, Suggestions} from '#components/suggestion/index.js';
import {Code} from '#components/typography/index.js';
import {
  PromptInput,
  PromptInputContextChip,
  PromptInputError,
  PromptInputField,
  PromptInputFooter,
  PromptInputStop,
  PromptInputSubmit,
  PromptInputTextarea,
} from './prompt-input.js';

const placeholder = "Ask about this project's runs";

const longDraft = Array.from(
  {length: 14},
  (_, index) => `Line ${index + 1} of a draft that has grown past the composer's height limit`,
).join('\n');

interface ComposerProps {
  initialValue?: string;
  disabled?: boolean;
  replying?: boolean;
  stopping?: boolean;
  chip?: string;
  error?: string;
  textareaClassName?: string;
}

function Composer({
  initialValue = '',
  disabled = false,
  replying = false,
  stopping = false,
  chip,
  error,
  textareaClassName,
}: ComposerProps) {
  const [value, setValue] = useState(initialValue);
  const errorId = error ? 'prompt-input-story-error' : undefined;

  return (
    <PromptInput
      value={value}
      onValueChange={setValue}
      onSubmit={() => setValue('')}
      disabled={disabled}
      submitDisabled={Boolean(error)}
    >
      {chip ? <PromptInputContextChip>{chip}</PromptInputContextChip> : null}
      <PromptInputField>
        <PromptInputTextarea
          aria-label="Message Shippy"
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          placeholder={placeholder}
          className={textareaClassName}
        />
        <PromptInputFooter>
          <PromptInputSubmit
            stop={replying ? <PromptInputStop stopping={stopping} /> : undefined}
          />
        </PromptInputFooter>
      </PromptInputField>
      {error ? <PromptInputError id={errorId}>{error}</PromptInputError> : null}
    </PromptInput>
  );
}

function Labeled({label, ...props}: ComponentProps<typeof Composer> & {label: string}) {
  return (
    <div className="grid gap-8">
      <Code variant="label" className="text-foreground-neutral-subtle">
        {label}
      </Code>
      <Composer {...props} />
    </div>
  );
}

const meta = {
  title: 'Components/PromptInput',
  component: Composer,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-368">
        <Story />
      </div>
    ),
  ],
  args: {
    chip: 'Viewing run #214',
    disabled: false,
    replying: false,
    stopping: false,
  },
} satisfies Meta<typeof Composer>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const States: Story = {
  render: () => (
    <div className="grid gap-16">
      <Labeled label="empty" />
      <Labeled label="draft" initialValue="Why did this run fail?" />
      <Labeled label="focus" textareaClassName="focus" />
      <Labeled label="replying, empty" replying />
      <Labeled label="replying, draft" replying initialValue="Also check the lint job" />
      <Labeled label="stopping" replying stopping />
      <Labeled
        label="too long"
        initialValue="A message that went over the limit."
        error="This message is too long. Shorten it to send."
      />
      <Labeled
        label="replying, too long"
        replying
        initialValue="A message that went over the limit."
        error="This message is too long. Shorten it to send."
      />
      <Labeled label="disabled" disabled />
    </div>
  ),
  parameters: {
    pseudo: {
      focusVisible: '.focus',
    },
  },
};

export const Content: Story = {
  render: () => (
    <div className="grid gap-16">
      <Labeled
        label="wraps and grows"
        initialValue="Compare this run with the last one that passed on main and list what changed."
      />
      <Labeled label="scrolls past the height limit" initialValue={longDraft} />
      <Labeled
        label="long context"
        chip="Viewing the workflow inspector for deploy-preview-with-a-very-long-name.yml"
      />
    </div>
  ),
};

export const Compositions: Story = {
  render: () => (
    <div className="grid gap-16">
      <Suggestions>
        <Suggestion suggestion="Why did this run fail?" />
      </Suggestions>
      <Composer chip="Viewing run #214" />
    </div>
  ),
};

function ComposerDisabledWhileSending() {
  const [value, setValue] = useState('Why did this run fail?');
  const [sending, setSending] = useState(false);

  return (
    <div className="grid gap-16">
      <PromptInput
        value={value}
        onValueChange={setValue}
        disabled={sending}
        onSubmit={() => {
          setValue('');
          setSending(true);
        }}
      >
        <PromptInputField>
          <PromptInputTextarea aria-label="Message Shippy" placeholder={placeholder} />
          <PromptInputFooter>
            <PromptInputSubmit />
          </PromptInputFooter>
        </PromptInputField>
      </PromptInput>
      <button type="button" onClick={() => setSending(false)}>
        Finish sending
      </button>
    </div>
  );
}

export const TestFocusReturnsAfterDisabledSend: Story = {
  render: () => <ComposerDisabledWhileSending />,
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    const textarea = canvas.getByRole('textbox', {name: 'Message Shippy'});
    await userEvent.click(textarea);
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(textarea).toBeDisabled());
    await waitFor(() => expect(document.activeElement).not.toBe(textarea));

    // Focus has fallen to the body, so re-enable without moving it to the button.
    canvas.getByRole('button', {name: 'Finish sending'}).click();

    await waitFor(() => expect(document.activeElement).toBe(textarea));
  },
};

function ComposerWithEndingReply() {
  const [value, setValue] = useState('');
  const [replying, setReplying] = useState(true);

  return (
    <div className="grid gap-16">
      <PromptInput value={value} onValueChange={setValue} onSubmit={() => setValue('')}>
        <PromptInputField>
          <PromptInputTextarea aria-label="Message Shippy" placeholder={placeholder} />
          <PromptInputFooter>
            <PromptInputSubmit stop={replying ? <PromptInputStop /> : undefined} />
          </PromptInputFooter>
        </PromptInputField>
      </PromptInput>
      <button type="button" onClick={() => setReplying(false)}>
        End reply
      </button>
    </div>
  );
}

export const TestFocusReturnsWhenReplyEnds: Story = {
  render: () => <ComposerWithEndingReply />,
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    const textarea = canvas.getByRole('textbox', {name: 'Message Shippy'});
    const stop = canvas.getByRole('button', {name: 'Stop reply'});
    stop.focus();
    await expect(document.activeElement).toBe(stop);

    canvas.getByRole('button', {name: 'End reply'}).click();

    await waitFor(() => expect(document.activeElement).toBe(textarea));
  },
};
