import {act, fireEvent, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {useState} from 'react';
import {
  PromptInput,
  PromptInputField,
  PromptInputFooter,
  PromptInputStop,
  PromptInputSubmit,
  PromptInputTextarea,
  type PromptInputTextareaProps,
} from './prompt-input.js';

interface ComposerProps {
  initialValue?: string;
  replying?: boolean;
  stopping?: boolean;
  disabled?: boolean;
  submitDisabled?: boolean;
  onSubmit?: (value: string) => unknown;
  clearOnSubmit?: boolean;
  onStop?: () => void;
  textareaProps?: PromptInputTextareaProps;
}

function Composer({
  initialValue = '',
  replying = false,
  stopping = false,
  disabled = false,
  submitDisabled = false,
  onSubmit,
  clearOnSubmit = true,
  onStop,
  textareaProps,
}: ComposerProps) {
  const [value, setValue] = useState(initialValue);

  return (
    <PromptInput
      value={value}
      onValueChange={setValue}
      disabled={disabled}
      submitDisabled={submitDisabled}
      onSubmit={(message) => {
        if (clearOnSubmit) setValue('');
        return onSubmit?.(message);
      }}
    >
      <PromptInputField>
        <PromptInputTextarea aria-label="Message" {...textareaProps} />
        <PromptInputFooter data-testid="footer">
          <PromptInputSubmit
            stop={replying ? <PromptInputStop stopping={stopping} onClick={onStop} /> : undefined}
          />
        </PromptInputFooter>
      </PromptInputField>
    </PromptInput>
  );
}

function ControlledDisabled({disabled}: {disabled: boolean}) {
  return (
    <>
      <PromptInput
        value="draft"
        onValueChange={() => undefined}
        onSubmit={() => undefined}
        disabled={disabled}
      >
        <PromptInputField>
          <PromptInputTextarea aria-label="Message" />
        </PromptInputField>
      </PromptInput>
      <button type="button">Outside</button>
    </>
  );
}

function textarea() {
  return screen.getByRole<HTMLTextAreaElement>('textbox', {name: 'Message'});
}

describe('PromptInput', () => {
  test('sends the draft on Enter', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<Composer onSubmit={onSubmit} />);

    await user.type(textarea(), 'Hi{Enter}');

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('Hi');
  });

  test('adds a line on Shift+Enter without sending', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<Composer onSubmit={onSubmit} />);

    await user.type(textarea(), 'a{Shift>}{Enter}{/Shift}b');

    expect(onSubmit).not.toHaveBeenCalled();
    expect(textarea().value).toBe('a\nb');
  });

  test.each(['', '   \n  '])('does not send a blank draft: %j', (initialValue) => {
    const onSubmit = vi.fn();
    render(<Composer initialValue={initialValue} onSubmit={onSubmit} />);

    fireEvent.keyDown(textarea(), {key: 'Enter'});

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', {name: 'Send message'})).toHaveProperty('disabled', true);
  });

  test.each([
    {name: 'isComposing', init: {isComposing: true}},
    {name: 'keyCode 229', init: {keyCode: 229}},
  ])('leaves Enter to the IME during composition: $name', ({init}) => {
    const onSubmit = vi.fn();
    render(<Composer initialValue="こんにちは" onSubmit={onSubmit} />);

    fireEvent.keyDown(textarea(), {key: 'Enter', ...init});

    expect(onSubmit).not.toHaveBeenCalled();
  });

  test('keeps Enter from sending when submitDisabled, and the draft editable', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<Composer initialValue="too long" submitDisabled onSubmit={onSubmit} />);

    await user.type(textarea(), '{Enter}');

    expect(onSubmit).not.toHaveBeenCalled();
    expect(textarea().disabled).toBe(false);
    expect(screen.getByRole('button', {name: 'Send message'})).toHaveProperty('disabled', true);
  });

  test('ignores a held Enter without typing a line', () => {
    const onSubmit = vi.fn();
    render(<Composer initialValue="draft" clearOnSubmit={false} onSubmit={onSubmit} />);

    const notPrevented = fireEvent.keyDown(textarea(), {key: 'Enter', repeat: true});

    expect(onSubmit).not.toHaveBeenCalled();
    expect(notPrevented).toBe(false);
  });

  test('ignores another send until a pending send settles, then allows a retry', async () => {
    let resolve: () => void = () => undefined;
    const promise = new Promise<void>((settle) => {
      resolve = settle;
    });
    const onSubmit = vi.fn(() => promise);
    render(<Composer initialValue="draft" clearOnSubmit={false} onSubmit={onSubmit} />);

    fireEvent.keyDown(textarea(), {key: 'Enter'});
    fireEvent.keyDown(textarea(), {key: 'Enter'});
    expect(onSubmit).toHaveBeenCalledOnce();

    resolve();
    await act(() => promise);
    fireEvent.keyDown(textarea(), {key: 'Enter'});

    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(textarea().value).toBe('draft');
  });

  test('adds a line on Return with a touch keyboard', () => {
    vi.stubGlobal('matchMedia', () => ({matches: true}));
    const onSubmit = vi.fn();
    render(<Composer initialValue="draft" onSubmit={onSubmit} />);

    const notPrevented = fireEvent.keyDown(textarea(), {key: 'Enter'});

    expect(onSubmit).not.toHaveBeenCalled();
    expect(notPrevented).toBe(true);
    vi.unstubAllGlobals();
  });

  test('lets a keydown handler take Enter', () => {
    const onSubmit = vi.fn();
    render(
      <Composer
        initialValue="draft"
        onSubmit={onSubmit}
        textareaProps={{onKeyDown: (event) => event.preventDefault()}}
      />,
    );

    fireEvent.keyDown(textarea(), {key: 'Enter'});

    expect(onSubmit).not.toHaveBeenCalled();
  });

  test('blocks input and sending while disabled', () => {
    const onSubmit = vi.fn();
    render(<Composer initialValue="draft" disabled onSubmit={onSubmit} />);

    fireEvent.keyDown(textarea(), {key: 'Enter'});

    expect(onSubmit).not.toHaveBeenCalled();
    expect(textarea().disabled).toBe(true);
    expect(screen.getByRole('button', {name: 'Send message'})).toHaveProperty('disabled', true);
  });

  test('sends by keyboard from the Send button and returns focus to the textarea', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<Composer initialValue="draft" onSubmit={onSubmit} />);

    await user.tab();
    await user.tab();
    await user.keyboard('{Enter}');

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('draft');
    expect(document.activeElement).toBe(textarea());
  });

  test('focuses the textarea when bare footer space is clicked', async () => {
    const user = userEvent.setup();
    render(<Composer initialValue="draft" />);

    await user.click(screen.getByTestId('footer'));

    expect(document.activeElement).toBe(textarea());
  });

  test('leaves focus alone when a control in the footer is clicked', async () => {
    const user = userEvent.setup();
    render(
      <PromptInput value="" onValueChange={() => undefined} onSubmit={() => undefined}>
        <PromptInputField>
          <PromptInputTextarea aria-label="Message" />
          <PromptInputFooter>
            <input type="checkbox" aria-label="Think harder" />
          </PromptInputFooter>
        </PromptInputField>
      </PromptInput>,
    );
    const checkbox = screen.getByRole('checkbox', {name: 'Think harder'});

    await user.click(checkbox);

    expect(document.activeElement).toBe(checkbox);
  });

  test('returns focus when the composer is enabled again', async () => {
    const user = userEvent.setup();
    const {rerender} = render(<ControlledDisabled disabled={false} />);
    await user.click(textarea());
    rerender(<ControlledDisabled disabled />);
    act(() => textarea().blur());

    rerender(<ControlledDisabled disabled={false} />);

    expect(document.activeElement).toBe(textarea());
  });

  test('keeps focus elsewhere when the reader moved on while it was disabled', async () => {
    const user = userEvent.setup();
    const {rerender} = render(<ControlledDisabled disabled={false} />);
    await user.click(textarea());
    rerender(<ControlledDisabled disabled />);
    const outside = screen.getByRole('button', {name: 'Outside'});
    act(() => outside.focus());

    rerender(<ControlledDisabled disabled={false} />);

    expect(document.activeElement).toBe(outside);
  });
});

describe('PromptInputSubmit', () => {
  test('shows Stop reply instead of Send while the composer is empty', () => {
    render(<Composer replying />);

    expect(screen.getByRole('button', {name: 'Stop reply'})).toBeTruthy();
    expect(screen.queryByRole('button', {name: 'Send message'})).toBeNull();
  });

  test('shows both Send and Stop reply when a message is typed during a reply', async () => {
    const user = userEvent.setup();
    render(<Composer replying />);

    await user.type(textarea(), 'a');

    expect(screen.getByRole('button', {name: 'Send message'})).toBeTruthy();
    expect(screen.getByRole('button', {name: 'Stop reply'})).toBeTruthy();
  });

  test('keeps Stop reply available when the draft cannot be sent', () => {
    render(<Composer replying initialValue="too long" submitDisabled />);

    expect(screen.getByRole('button', {name: 'Send message'})).toHaveProperty('disabled', true);
    expect(screen.getByRole<HTMLButtonElement>('button', {name: 'Stop reply'}).disabled).toBe(
      false,
    );
  });
});

describe('PromptInputStop', () => {
  test('stops by keyboard and returns focus to the textarea', async () => {
    const onStop = vi.fn();
    const user = userEvent.setup();
    render(<Composer replying onStop={onStop} />);

    await user.tab();
    await user.tab();
    await user.keyboard('{Enter}');

    expect(onStop).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(textarea());
  });

  test('reads Stopping and ignores clicks until the reply ends', () => {
    const onStop = vi.fn();
    render(<Composer replying stopping onStop={onStop} />);

    const stopping = screen.getByRole<HTMLButtonElement>('button', {name: 'Stopping'});
    fireEvent.click(stopping);

    expect(stopping.disabled).toBe(true);
    expect(onStop).not.toHaveBeenCalled();
  });

  test('keeps keyboard focus in the composer when the reply ends under it', async () => {
    const user = userEvent.setup();
    const {rerender} = render(<Composer replying />);
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', {name: 'Stop reply'}));

    rerender(<Composer />);

    expect(document.activeElement).toBe(textarea());
  });
});
