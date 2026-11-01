'use client';

// Adapted from shadcn/ui (MIT). See THIRD_PARTY_NOTICES.md at the package root.

import {
  type ComponentProps,
  createContext,
  type FocusEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import {Button, IconButton} from '#components/button/index.js';
import {Icon, type IconName} from '#components/icon/index.js';
import {Textarea, type TextareaProps} from '#components/textarea/index.js';
import {Text} from '#components/typography/index.js';
import {cn} from '#utils/cn.js';

interface PromptInputContextValue {
  value: string;
  onValueChange: (value: string) => void;
  disabled: boolean;
  hasText: boolean;
  canSubmit: boolean;
}

const PromptInputContext = createContext<PromptInputContextValue | null>(null);

function usePromptInput(): PromptInputContextValue {
  const context = useContext(PromptInputContext);
  if (!context) throw new Error('PromptInput parts must be used inside a <PromptInput>.');
  return context;
}

function focusTextarea(form: HTMLFormElement | null | undefined): void {
  form?.querySelector('textarea')?.focus();
}

// A soft keyboard has no Shift key, so Return has to add a line there.
function hasSoftKeyboard(): boolean {
  return window.matchMedia?.('(pointer: coarse)').matches ?? false;
}

export interface PromptInputProps extends Omit<ComponentProps<'form'>, 'onSubmit' | 'ref'> {
  value: string;
  onValueChange: (value: string) => void;
  /**
   * Called on `Enter` or Send, never with blank text. The caller clears `value`,
   * so a refused message keeps its draft. Return a promise to ignore further
   * sends until it settles.
   */
  onSubmit: (value: string) => unknown;
  /** Blocks typing and sending. */
  disabled?: boolean;
  /** Blocks `Enter` and Send but keeps the draft editable, as for an over-limit message. */
  submitDisabled?: boolean;
}

/**
 * The chat composer. Controlled, so the caller can keep a draft across
 * navigation. Focus returns to the textarea after each send, because Send
 * disables itself once the draft clears and would otherwise drop keyboard focus.
 * If `disabled` takes focus away, focus returns when the composer is enabled.
 */
export function PromptInput({
  value,
  onValueChange,
  onSubmit,
  disabled = false,
  submitDisabled = false,
  className,
  children,
  onFocus,
  onBlur,
  ...props
}: PromptInputProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const isSubmitting = useRef(false);
  const hasFocus = useRef(false);
  const heldFocusWhenDisabled = useRef(false);
  const hasText = value.trim().length > 0;
  const canSubmit = hasText && !disabled && !submitDisabled;
  const context = useMemo(
    () => ({value, onValueChange, disabled, hasText, canSubmit}),
    [value, onValueChange, disabled, hasText, canSubmit],
  );

  // Chromium clears `activeElement` as soon as the textarea is disabled, so this
  // reads the focus events instead. React drops events fired during a commit,
  // which keeps `hasFocus` true here.
  useLayoutEffect(() => {
    if (disabled) {
      heldFocusWhenDisabled.current = hasFocus.current;
      return;
    }

    if (heldFocusWhenDisabled.current && document.activeElement === document.body) {
      focusTextarea(formRef.current);
    }
    heldFocusWhenDisabled.current = false;
  }, [disabled]);

  function handleFocus(event: FocusEvent<HTMLFormElement>) {
    hasFocus.current = true;
    onFocus?.(event);
  }

  function handleBlur(event: FocusEvent<HTMLFormElement>) {
    hasFocus.current = event.currentTarget.contains(event.relatedTarget);
    onBlur?.(event);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || isSubmitting.current) return;

    isSubmitting.current = true;
    focusTextarea(event.currentTarget);
    try {
      await onSubmit(value);
    } finally {
      isSubmitting.current = false;
    }
  }

  return (
    <PromptInputContext.Provider value={context}>
      <form
        {...props}
        ref={formRef}
        data-slot="prompt-input"
        className={cn('flex w-full min-w-0 flex-col gap-6', className)}
        onSubmit={handleSubmit}
        onFocus={handleFocus}
        onBlur={handleBlur}
      >
        {children}
      </form>
    </PromptInputContext.Provider>
  );
}

export interface PromptInputContextChipProps extends ComponentProps<'span'> {
  icon?: IconName;
}

/** Sits above the field and tells the reader what the agent can see. */
export function PromptInputContextChip({
  icon = 'eyeLine',
  className,
  children,
  ...props
}: PromptInputContextChipProps) {
  return (
    <span
      data-slot="prompt-input-context-chip"
      className={cn(
        'inline-flex h-20 w-fit max-w-full items-center gap-4 rounded-4 bg-background-components-base px-6 text-xs text-foreground-neutral-subtle',
        className,
      )}
      {...props}
    >
      <Icon name={icon} className="size-14 shrink-0" aria-hidden="true" />
      <span className="truncate">{children}</span>
    </span>
  );
}

export function PromptInputField({className, ...props}: ComponentProps<'div'>) {
  return (
    <div
      data-slot="prompt-input-field"
      className={cn(
        'flex min-w-0 flex-col rounded-6 bg-background-field-base shadow-button-neutral transition-[background-color,box-shadow]',
        'hover:bg-background-field-hover',
        'has-[textarea:focus-visible]:shadow-border-interactive-with-active',
        'has-[textarea[aria-invalid=true]]:shadow-border-error',
        'has-[textarea:disabled]:bg-background-neutral-disabled has-[textarea:disabled]:shadow-none has-[textarea:disabled]:hover:bg-background-neutral-disabled',
        className,
      )}
      {...props}
    />
  );
}

export type PromptInputTextareaProps = Omit<
  TextareaProps,
  'value' | 'defaultValue' | 'disabled' | 'variant' | 'size'
>;

/**
 * Grows with its content up to 192px, then scrolls. `Enter` sends and
 * `Shift+Enter` adds a line. With a touch keyboard, Return adds a line and Send
 * sends. A handler that calls `preventDefault()` in `onKeyDown` keeps `Enter`
 * from sending.
 */
export function PromptInputTextarea({
  className,
  onChange,
  onKeyDown,
  ...props
}: PromptInputTextareaProps) {
  const {value, onValueChange, disabled} = usePromptInput();

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented || event.key !== 'Enter' || event.shiftKey) return;
    // Enter also confirms an IME candidate. Safari ends composition before this
    // event, so it reports keyCode 229 instead of isComposing.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (hasSoftKeyboard()) return;

    event.preventDefault();
    // Holding Enter repeats this event. It must not send again or type new lines.
    if (!event.repeat) event.currentTarget.form?.requestSubmit();
  }

  return (
    <Textarea
      rows={1}
      value={value}
      disabled={disabled}
      onChange={(event) => {
        onChange?.(event);
        onValueChange(event.target.value);
      }}
      onKeyDown={handleKeyDown}
      // The field draws the frame, and tailwind-merge can't strip the base
      // shadow tokens, so `!` wins the cascade.
      className={cn(
        'max-h-192 min-h-28 resize-none overflow-y-auto rounded-none bg-transparent px-12 pt-8 pb-0 field-sizing-content',
        'shadow-none! hover:bg-transparent focus-visible:shadow-none! aria-invalid:shadow-none! disabled:bg-transparent',
        className,
      )}
      {...props}
    />
  );
}

export function PromptInputFooter({className, onClick, ...props}: ComponentProps<'div'>) {
  function handleClick(event: MouseEvent<HTMLDivElement>) {
    onClick?.(event);
    // Only bare footer space. Clicks in a control, or in a portal that bubbles
    // through React, keep their own focus.
    if (event.target === event.currentTarget) focusTextarea(event.currentTarget.closest('form'));
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a pointer convenience, so the field reads as one input; the textarea is already in the tab order.
    // biome-ignore lint/a11y/useKeyWithClickEvents: same as above, keyboard users reach the textarea directly.
    <div
      data-slot="prompt-input-footer"
      // Send is 28px and Stop is 24px. The minimum keeps the swap from moving the field.
      className={cn(
        'flex min-h-36 min-w-0 cursor-text items-center justify-end gap-8 px-8 pb-8',
        className,
      )}
      onClick={handleClick}
      {...props}
    />
  );
}

export interface PromptInputSubmitProps
  extends Omit<
    ComponentProps<typeof IconButton>,
    'icon' | 'type' | 'children' | 'disabled' | 'isLoading' | 'asChild'
  > {
  /**
   * Usually `PromptInputStop`. It replaces Send while the composer is empty. With
   * a draft, both show, so a message can queue and a reply can still stop.
   */
  stop?: ReactNode;
}

export function PromptInputSubmit({
  stop,
  className,
  'aria-label': ariaLabel = 'Send message',
  ...props
}: PromptInputSubmitProps) {
  const {hasText, canSubmit} = usePromptInput();
  const showSend = !stop || hasText;

  return (
    <>
      {stop}
      {showSend ? (
        <IconButton
          variant="primary"
          size="sm"
          {...props}
          type="submit"
          aria-label={ariaLabel}
          disabled={!canSubmit}
          className={cn('enabled:text-foreground-contrast-primary', className)}
        >
          <Icon name="arrowUpLine" className="size-16" />
        </IconButton>
      ) : null}
    </>
  );
}

export interface PromptInputStopProps
  extends Omit<
    ComponentProps<typeof Button>,
    | 'variant'
    | 'size'
    | 'type'
    | 'iconLeft'
    | 'iconRight'
    | 'isLoading'
    | 'asChild'
    | 'children'
    | 'disabled'
    | 'ref'
  > {
  /** A running tool call finishes before a reply ends, so this reads `Stopping` until it does. */
  stopping?: boolean;
}

export function PromptInputStop({stopping = false, onClick, ...props}: PromptInputStopProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  // This button disappears when the reply ends, which would drop keyboard focus
  // to the body.
  useLayoutEffect(() => {
    const button = buttonRef.current;
    return () => {
      if (button === document.activeElement) focusTextarea(button?.form);
    };
  }, []);

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    onClick?.(event);
    focusTextarea(event.currentTarget.form);
  }

  return (
    <Button
      {...props}
      ref={buttonRef}
      type="button"
      variant="secondary"
      size="xs"
      iconLeft="stopFill"
      disabled={stopping}
      onClick={handleClick}
    >
      {stopping ? 'Stopping' : 'Stop reply'}
    </Button>
  );
}

/** Pair it with `aria-invalid` and `aria-describedby` on `PromptInputTextarea`. */
export function PromptInputError({className, ...props}: ComponentProps<'p'>) {
  return (
    <Text
      as="p"
      size="xs"
      data-slot="prompt-input-error"
      aria-live="polite"
      className={cn('text-tag-error-text', className)}
      {...props}
    />
  );
}
