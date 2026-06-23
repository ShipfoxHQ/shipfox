import type {TriggerEventListItemDto} from '@shipfox/api-triggers-dto';
import {Code, Dot, RelativeTime, TableCell, TableRow, Text} from '@shipfox/react-ui';
import {triggerEventMatchSummary} from './trigger-event-match-summary.js';
import {getTriggerOutcomeVisual} from './trigger-outcome.js';
import {TriggerSourceIcon} from './trigger-source-icon.js';

/**
 * One event as a table row. Status leads as a dot (pulsing while evaluation is in flight);
 * source/event/delivery_id are `font-code`; the received time is right-aligned. Rows are
 * non-interactive in v1 — the detail surface (ENG-552) makes them clickable.
 */
export function TriggerEventRow({event}: {event: TriggerEventListItemDto}) {
  const visual = getTriggerOutcomeVisual(event.outcome);

  return (
    <TableRow>
      <TableCell className="w-0 pr-0">
        <Dot variant={visual.dot} ripple={visual.ripple} />
        <span className="sr-only">{visual.label}</span>
      </TableCell>
      <TableCell>
        <span className="flex min-w-0 items-center gap-6">
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
        </span>
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
