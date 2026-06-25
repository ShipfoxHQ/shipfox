import type {TriggerEventListItemDto} from '@shipfox/api-triggers-dto';
import {Code, Dot, RelativeTime, TableCell, TableRow, Text} from '@shipfox/react-ui';
import type {MouseEvent} from 'react';
import {triggerEventMatchSummary} from './trigger-event-match-summary.js';
import {getTriggerOutcomeVisual} from './trigger-outcome.js';
import {TriggerSourceIcon} from './trigger-source-icon.js';

interface TriggerEventRowProps {
  event: TriggerEventListItemDto;
  selected: boolean;
  onSelect: (eventId: string) => void;
}

export function TriggerEventRow({event, selected, onSelect}: TriggerEventRowProps) {
  const visual = getTriggerOutcomeVisual(event.outcome);

  function handleRowClick(clickEvent: MouseEvent<HTMLTableRowElement>) {
    const target = clickEvent.target;
    if (target instanceof HTMLElement && target.closest('button,a')) return;
    onSelect(event.id);
  }

  return (
    <TableRow
      data-selected={selected ? 'true' : undefined}
      className="cursor-pointer"
      onClick={handleRowClick}
    >
      <TableCell className="w-0 pr-0">
        <Dot variant={visual.dot} ripple={visual.ripple} />
        <span className="sr-only">{visual.label}</span>
      </TableCell>
      <TableCell>
        <button
          type="button"
          className="flex min-w-0 items-center gap-6 rounded-6 text-left outline-none focus-visible:shadow-button-neutral-focus"
          onClick={() => onSelect(event.id)}
          aria-label={`Open details for ${event.source} ${event.event}`}
        >
          <TriggerSourceIcon
            source={event.source}
            aria-hidden="true"
            className="size-16 shrink-0 text-foreground-neutral-muted"
          />
          <Code as="span" variant="label" className="truncate text-foreground-neutral-base">
            {event.source}
          </Code>
          <Code as="span" variant="label" className="truncate text-foreground-neutral-subtle">
            {event.event}
          </Code>
        </button>
      </TableCell>
      <TableCell>
        <Text size="sm" className="text-foreground-neutral-subtle">
          {triggerEventMatchSummary(event)}
        </Text>
      </TableCell>
      <TableCell>
        {event.delivery_id ? (
          <Code as="span" variant="label" className="truncate text-foreground-neutral-muted">
            {event.delivery_id}
          </Code>
        ) : (
          <span className="text-foreground-neutral-disabled">—</span>
        )}
      </TableCell>
      <TableCell className="text-right">
        <Code as="span" variant="label" className="text-foreground-neutral-muted">
          <RelativeTime value={event.received_at} />
        </Code>
      </TableCell>
    </TableRow>
  );
}
