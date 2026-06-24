import {
  Code,
  cn,
  Text,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useCopyToClipboard,
} from '@shipfox/react-ui';
import {useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';

export function Identifier({
  display,
  value,
  label = 'identifier',
}: {
  display: string;
  value: string;
  label?: string | undefined;
}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const [feedbackPosition, setFeedbackPosition] = useState<{
    left: number;
    top: number;
    placement: 'top' | 'bottom';
  } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const {copy} = useCopyToClipboard({
    text: value,
    onCopy: () => {
      setTemporaryCopyState('copied', 2500);
    },
  });

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  function setTemporaryCopyState(state: 'copied' | 'failed', timeout: number) {
    const rect = buttonRef.current?.getBoundingClientRect();
    setCopyState(state);
    setTooltipOpen(false);
    setFeedbackPosition(
      rect
        ? {
            left: rect.left + rect.width / 2,
            top: rect.top > 32 ? rect.top : rect.bottom,
            placement: rect.top > 32 ? 'top' : 'bottom',
          }
        : null,
    );
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setCopyState('idle');
      setFeedbackPosition(null);
    }, timeout);
  }

  async function handleCopy() {
    try {
      await copy();
    } catch {
      setTemporaryCopyState('failed', 2500);
    }
  }

  const ariaLabel =
    copyState === 'copied'
      ? `Copied ${label} ${value}`
      : copyState === 'failed'
        ? `Could not copy ${label} ${value}`
        : `Copy ${label} ${value}`;

  const feedback =
    copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Could not copy' : null;

  const feedbackElement =
    feedback && feedbackPosition && typeof document !== 'undefined'
      ? createPortal(
          <Text
            as="span"
            role="status"
            size="xs"
            style={{
              left: feedbackPosition.left,
              top: feedbackPosition.top,
              transform:
                feedbackPosition.placement === 'top'
                  ? 'translate(-50%, calc(-100% - 8px))'
                  : 'translate(-50%, 8px)',
            }}
            className={cn(
              'pointer-events-none fixed z-50 whitespace-nowrap rounded-8 bg-background-components-base px-8 py-4 font-medium shadow-tooltip',
              copyState === 'failed'
                ? 'text-foreground-highlight-error'
                : 'text-foreground-neutral-base',
            )}
          >
            {feedback}
          </Text>,
          document.body,
        )
      : null;

  return (
    <>
      <Tooltip open={copyState === 'idle' ? tooltipOpen : false} onOpenChange={setTooltipOpen}>
        <TooltipTrigger asChild>
          <button
            ref={buttonRef}
            type="button"
            aria-label={ariaLabel}
            onClick={() => {
              void handleCopy();
            }}
            className="inline-flex min-w-0 items-center gap-4 rounded-4 text-foreground-neutral-muted outline-none transition-colors hover:text-foreground-neutral-base focus-visible:ring-2 focus-visible:ring-background-accent-blue-base focus-visible:ring-offset-2 focus-visible:ring-offset-background-subtle-base"
          >
            <Code as="span" variant="label" className="truncate">
              {display}
            </Code>
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <Code as="span" variant="label" className="block max-w-[360px] truncate">
            {value}
          </Code>
        </TooltipContent>
      </Tooltip>
      {feedbackElement}
    </>
  );
}
