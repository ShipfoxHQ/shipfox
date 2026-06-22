import type {RunResponseDto} from '@shipfox/api-workflows-dto';
import {
  Badge,
  Code,
  Dot,
  Header,
  Icon,
  RelativeTime,
  Text,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useCopyToClipboard,
} from '@shipfox/react-ui';
import {useEffect, useId, useRef, useState} from 'react';
import {toWorkflowRunSummary} from './workflow-run-summary-model.js';

export function WorkflowRunSummary({run}: {run: RunResponseDto}) {
  const headingId = useId();
  const model = toWorkflowRunSummary(run);

  return (
    <section
      aria-labelledby={headingId}
      className="border-b border-border-neutral-base bg-background-subtle-base px-16 py-12"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-12 gap-y-8">
        <div className="flex min-w-0 items-center gap-8">
          <Dot variant={model.status.dot} ripple={run.status === 'running'} className="size-8" />
          <Header id={headingId} variant="h3" className="min-w-0 truncate">
            {model.name}
          </Header>
        </div>

        <Badge variant={model.status.badge} iconLeft={model.status.icon} size="xs">
          {model.status.label}
        </Badge>

        <span
          aria-hidden="true"
          className="hidden h-20 w-px shrink-0 bg-border-neutral-base sm:block"
        />

        <RunId id={model.id} shortId={model.shortId} />

        {model.triggerLabel ? (
          <Text size="sm" className="min-w-0 truncate text-foreground-neutral-subtle">
            {model.triggerLabel}
          </Text>
        ) : null}

        <span className="min-w-0 flex-1" />

        <div className="flex min-w-0 flex-wrap items-center gap-x-12 gap-y-4 text-foreground-neutral-muted">
          <Text as="span" size="xs" className="inline-flex items-center gap-4">
            Created
            <RelativeTime value={model.createdAt} className="font-code text-xs leading-20" />
          </Text>
          <Text as="span" size="xs" className="inline-flex items-center gap-4">
            Updated
            <RelativeTime value={model.updatedAt} className="font-code text-xs leading-20" />
          </Text>
        </div>
      </div>
    </section>
  );
}

function RunId({id, shortId}: {id: string; shortId: string}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const {copy} = useCopyToClipboard({
    text: id,
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
      ? `Copied run id ${id}`
      : copyState === 'failed'
        ? `Could not copy run id ${id}`
        : `Copy run id ${id}`;

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
            {shortId}
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
            {id}
          </Code>
        </span>
      </TooltipContent>
    </Tooltip>
  );
}
