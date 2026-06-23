import {
  Code,
  Icon,
  Text,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useCopyToClipboard,
} from '@shipfox/react-ui';
import {useEffect, useRef, useState} from 'react';

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
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const {copy} = useCopyToClipboard({
    text: value,
    onCopy: () => {
      setTemporaryCopyState('copied', 1500);
    },
  });

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  function setTemporaryCopyState(state: 'copied' | 'failed', timeout: number) {
    setCopyState(state);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setCopyState('idle');
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

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          onClick={() => {
            void handleCopy();
          }}
          className="inline-flex min-w-0 items-center gap-4 rounded-4 text-foreground-neutral-muted outline-none transition-colors hover:text-foreground-neutral-base focus-visible:ring-2 focus-visible:ring-background-accent-blue-base focus-visible:ring-offset-2 focus-visible:ring-offset-background-subtle-base"
        >
          {copyState === 'copied' ? (
            <Icon
              name="check"
              aria-hidden="true"
              className="size-12 shrink-0 text-foreground-neutral-base"
            />
          ) : null}
          <Code as="span" variant="label" className="truncate">
            {display}
          </Code>
          {copyState === 'copied' ? (
            <Text as="span" size="xs" className="shrink-0 text-foreground-neutral-base">
              Copied
            </Text>
          ) : null}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <span className="flex max-w-[360px] flex-col gap-2">
          {copyState === 'idle' ? null : (
            <Text
              as="span"
              size="xs"
              className={copyState === 'failed' ? 'text-foreground-highlight-error' : undefined}
            >
              {copyState === 'copied' ? 'Copied' : 'Could not copy'}
            </Text>
          )}
          <Code as="span" variant="label" className="truncate">
            {value}
          </Code>
        </span>
      </TooltipContent>
    </Tooltip>
  );
}
