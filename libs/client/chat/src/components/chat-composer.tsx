import {
  PromptInput,
  PromptInputContextChip,
  PromptInputError,
  PromptInputField,
  PromptInputFooter,
  PromptInputStop,
  PromptInputSubmit,
  PromptInputTextarea,
} from '@shipfox/react-ui/prompt-input';
import {type KeyboardEvent, type Ref, useId} from 'react';

export interface ChatComposerProps {
  ref?: Ref<HTMLTextAreaElement> | undefined;
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: (value: string) => unknown;
  onBlur: () => void;
  /** What the agent sees, shown above the field. */
  contextLabel: string | undefined;
  /** Shows `Stop reply`, beside Send once there is a draft. */
  replying: boolean;
  stopping: boolean;
  onStop: () => void;
  disabled: boolean;
  /** Keeps the draft editable but unsendable, with the reason below the field. */
  error: string | undefined;
  onKeyDown?: ((event: KeyboardEvent<HTMLTextAreaElement>) => void) | undefined;
}

export function ChatComposer({
  ref,
  value,
  onValueChange,
  onSubmit,
  onBlur,
  contextLabel,
  replying,
  stopping,
  onStop,
  disabled,
  error,
  onKeyDown,
}: ChatComposerProps) {
  const errorId = useId();

  return (
    <PromptInput
      value={value}
      onValueChange={onValueChange}
      onSubmit={onSubmit}
      disabled={disabled}
      submitDisabled={error !== undefined}
      onBlur={onBlur}
      className="border-t border-border-neutral-base p-tight"
    >
      {contextLabel ? <PromptInputContextChip>{contextLabel}</PromptInputContextChip> : null}
      <PromptInputField>
        <PromptInputTextarea
          ref={ref}
          aria-label="Message Shippy"
          placeholder="Ask about this project's runs"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onKeyDown={onKeyDown}
        />
        <PromptInputFooter>
          <PromptInputSubmit
            stop={replying ? <PromptInputStop stopping={stopping} onClick={onStop} /> : undefined}
          />
        </PromptInputFooter>
      </PromptInputField>
      {error ? <PromptInputError id={errorId}>{error}</PromptInputError> : null}
    </PromptInput>
  );
}
