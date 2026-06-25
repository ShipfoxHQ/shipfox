import type {TriggerDecisionDto, TriggerEventDetailResponseDto} from '@shipfox/api-triggers-dto';
import {
  Alert,
  Badge,
  Button,
  Code,
  CodeBlock,
  CodeBlockBody,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockFiles,
  CodeBlockHeader,
  CodeBlockItem,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  cn,
  EmptyState,
  Header,
  Icon,
  RelativeTime,
  Skeleton,
  Text,
} from '@shipfox/react-ui';
import {Link} from '@tanstack/react-router';
import {type ReactNode, useMemo} from 'react';
import {useTriggerEventQuery} from '#hooks/api/trigger-events.js';
import {getTriggerDecisionVisual} from './trigger-decision.js';
import {triggerEventMatchSummary} from './trigger-event-match-summary.js';
import {getTriggerOutcomeVisual} from './trigger-outcome.js';
import {TriggerSourceIcon} from './trigger-source-icon.js';

const PANEL_CLASS =
  'min-h-0 rounded-8 border border-border-neutral-base bg-background-neutral-base';
const LOADING_ENVELOPE_PLACEHOLDERS = [
  'label-1',
  'value-1',
  'label-2',
  'value-2',
  'label-3',
  'value-3',
];

export interface TriggerEventDetailProps {
  workspaceId: string;
  eventId?: string | undefined;
  onBack: () => void;
}

export function TriggerEventDetail({workspaceId, eventId, onBack}: TriggerEventDetailProps) {
  const query = useTriggerEventQuery(eventId);

  if (!eventId) return <TriggerEventDetailPlaceholder />;
  if (query.data) {
    return <TriggerEventDetailView workspaceId={workspaceId} event={query.data} onBack={onBack} />;
  }
  if (query.isError)
    return <TriggerEventDetailError onBack={onBack} onRetry={() => query.refetch()} />;
  return <TriggerEventDetailLoading onBack={onBack} />;
}

export function TriggerEventDetailView({
  workspaceId,
  event,
  onBack,
}: {
  workspaceId: string;
  event: TriggerEventDetailResponseDto;
  onBack: () => void;
}) {
  const outcomeVisual = getTriggerOutcomeVisual(event.outcome);
  const formattedPayload = useMemo(
    () => JSON.stringify(event.payload ?? null, null, 2) ?? 'null',
    [event.payload],
  );

  return (
    <aside
      aria-label="Event details"
      className={cn(PANEL_CLASS, 'flex min-h-0 flex-col overflow-hidden')}
    >
      <div className="flex shrink-0 flex-col gap-12 border-b border-border-neutral-base p-16">
        <Button
          type="button"
          variant="transparentMuted"
          size="sm"
          iconLeft="arrowLeftLine"
          className="self-start min-[900px]:hidden"
          onClick={onBack}
        >
          Back to events
        </Button>
        <div className="flex min-w-0 items-start justify-between gap-12">
          <div className="flex min-w-0 flex-col gap-6">
            <div className="flex min-w-0 items-center gap-6">
              <TriggerSourceIcon
                source={event.source}
                aria-hidden="true"
                className="size-16 shrink-0 text-foreground-neutral-muted"
              />
              <Code as="span" variant="label" className="truncate text-foreground-neutral-muted">
                {event.source}
              </Code>
              <Code as="span" variant="label" className="truncate text-foreground-neutral-subtle">
                {event.event}
              </Code>
            </div>
            <Header variant="h4" as="h2" className="truncate text-foreground-neutral-base">
              {outcomeVisual.label}
            </Header>
          </div>
          <Badge variant={outcomeVisual.dot} size="xs">
            {triggerEventMatchSummary(event)}
          </Badge>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-16 overflow-y-auto p-16 scrollbar">
        <EventEnvelope event={event} />
        <EventStateBody event={event} />
        <EventDecisions workspaceId={workspaceId} decisions={event.decisions} />
        <EventPayload payload={formattedPayload} />
      </div>
    </aside>
  );
}

function TriggerEventDetailPlaceholder() {
  return (
    <aside
      aria-label="Event details"
      className={cn(
        PANEL_CLASS,
        'hidden min-h-[240px] items-center justify-center p-24 min-[900px]:flex',
      )}
    >
      <EmptyState icon="pulseLine" variant="compact" title="No event selected" />
    </aside>
  );
}

function TriggerEventDetailLoading({onBack}: {onBack: () => void}) {
  return (
    <aside
      aria-label="Event details"
      className={cn(PANEL_CLASS, 'flex min-h-[320px] flex-col gap-16 p-16')}
    >
      <Button
        type="button"
        variant="transparentMuted"
        size="sm"
        iconLeft="arrowLeftLine"
        className="self-start min-[900px]:hidden"
        onClick={onBack}
      >
        Back to events
      </Button>
      <div className="flex flex-col gap-8">
        <Skeleton className="h-16 w-160" />
        <Skeleton className="h-24 w-120" />
      </div>
      <div className="grid grid-cols-[92px_minmax(0,1fr)] gap-x-10 gap-y-8">
        {LOADING_ENVELOPE_PLACEHOLDERS.map((key) => (
          <Skeleton key={key} className="h-16" />
        ))}
      </div>
      <Skeleton className="h-96" />
      <Skeleton className="h-160" />
    </aside>
  );
}

function TriggerEventDetailError({onBack, onRetry}: {onBack: () => void; onRetry: () => void}) {
  return (
    <aside aria-label="Event details" className={cn(PANEL_CLASS, 'flex flex-col gap-16 p-16')}>
      <Button
        type="button"
        variant="transparentMuted"
        size="sm"
        iconLeft="arrowLeftLine"
        className="self-start min-[900px]:hidden"
        onClick={onBack}
      >
        Back to events
      </Button>
      <Alert variant="error" animated={false}>
        <div className="flex items-center justify-between gap-12">
          <Text size="sm">Event detail could not be loaded.</Text>
          <Button type="button" variant="secondary" size="xs" onClick={onRetry}>
            Retry
          </Button>
        </div>
      </Alert>
    </aside>
  );
}

function EventEnvelope({event}: {event: TriggerEventDetailResponseDto}) {
  const rows = [
    {label: 'Event ref', value: <CodeValue>{event.event_ref}</CodeValue>},
    {label: 'Origin', value: event.origin},
    {
      label: 'Delivery',
      value: event.delivery_id ? <CodeValue>{event.delivery_id}</CodeValue> : null,
    },
    {
      label: 'Connection',
      value: event.connection_id ? <CodeValue>{event.connection_id}</CodeValue> : null,
    },
    {label: 'Received', value: <RelativeTime value={event.received_at} />},
    {
      label: 'Processed',
      value: event.processed_at ? <RelativeTime value={event.processed_at} /> : null,
    },
  ];

  return (
    <section aria-labelledby="trigger-event-envelope-heading" className="flex flex-col gap-8">
      <Text id="trigger-event-envelope-heading" size="sm" bold>
        Envelope
      </Text>
      <dl className="grid grid-cols-[92px_minmax(0,1fr)] gap-x-10 gap-y-6">
        {rows.map((row) => (
          <EnvelopeRow key={row.label} label={row.label}>
            {row.value ?? <MutedDash />}
          </EnvelopeRow>
        ))}
      </dl>
    </section>
  );
}

function EnvelopeRow({label, children}: {label: string; children: ReactNode}) {
  return (
    <>
      <dt>
        <Text size="xs" className="text-foreground-neutral-muted">
          {label}
        </Text>
      </dt>
      <dd className="min-w-0 truncate text-sm leading-20 text-foreground-neutral-base">
        {children}
      </dd>
    </>
  );
}

function EventStateBody({event}: {event: TriggerEventDetailResponseDto}) {
  const erroredDecisions = event.decisions.filter((decision) => decision.decision === 'errored');

  if (event.outcome === 'discarded') {
    return (
      <section aria-labelledby="trigger-event-state-heading">
        <h3 id="trigger-event-state-heading" className="sr-only">
          Event state
        </h3>
        <EmptyState
          icon="subtractLine"
          variant="compact"
          title="Matched no subscriptions"
          className="rounded-8 border border-border-neutral-base bg-background-subtle-base p-16"
        />
      </section>
    );
  }

  if (event.outcome !== 'failed' && event.outcome !== 'errored') return null;

  return (
    <section aria-labelledby="trigger-event-state-heading" className="flex flex-col gap-8">
      <Text id="trigger-event-state-heading" size="sm" bold>
        Failure reason
      </Text>
      {erroredDecisions.length > 0 ? (
        <ul className="flex flex-col gap-6">
          {erroredDecisions.map((decision) => (
            <li key={decision.id} className="text-sm leading-20 text-foreground-neutral-base">
              {decision.reason ?? 'No reason recorded'}
            </li>
          ))}
        </ul>
      ) : (
        <Text size="sm" className="text-foreground-neutral-muted">
          No reason recorded
        </Text>
      )}
    </section>
  );
}

function EventDecisions({
  workspaceId,
  decisions,
}: {
  workspaceId: string;
  decisions: TriggerDecisionDto[];
}) {
  if (decisions.length === 0) return null;

  return (
    <section aria-labelledby="trigger-event-decisions-heading" className="flex flex-col gap-10">
      <div className="flex flex-col gap-2">
        <Text id="trigger-event-decisions-heading" size="sm" bold>
          Decisions
        </Text>
        <Text size="xs" className="text-foreground-neutral-muted">
          Shows trigger routing only; inspect each run for in-run behavior.
        </Text>
      </div>
      <ul className="flex flex-col divide-y divide-border-neutral-base rounded-8 border border-border-neutral-base">
        {decisions.map((decision) => (
          <DecisionRow key={decision.id} workspaceId={workspaceId} decision={decision} />
        ))}
      </ul>
    </section>
  );
}

function DecisionRow({workspaceId, decision}: {workspaceId: string; decision: TriggerDecisionDto}) {
  const visual = getTriggerDecisionVisual(decision.decision);

  return (
    <li className="flex min-w-0 flex-col gap-6 p-10">
      <div className="flex min-w-0 items-center justify-between gap-10">
        <Text size="sm" bold className="min-w-0 truncate text-foreground-neutral-base">
          {decision.subscription_name}
        </Text>
        <Badge variant={visual.badge} size="2xs">
          {visual.label}
        </Badge>
      </div>
      <RunLink workspaceId={workspaceId} decision={decision} />
      {decision.reason ? (
        <Text size="xs" className="text-foreground-neutral-muted">
          {decision.reason}
        </Text>
      ) : null}
    </li>
  );
}

function RunLink({workspaceId, decision}: {workspaceId: string; decision: TriggerDecisionDto}) {
  if (!decision.run_id || !decision.run_name) {
    return (
      <Text size="xs" className="text-foreground-neutral-disabled">
        No run created
      </Text>
    );
  }

  return (
    <Link
      to="/workspaces/$wid/projects/$pid/runs/$runId"
      params={{wid: workspaceId, pid: decision.project_id, runId: decision.run_id}}
      className="inline-flex min-w-0 items-center gap-4 self-start rounded-6 text-foreground-highlight-interactive underline-offset-2 hover:text-foreground-highlight-interactive-hover hover:underline focus-visible:outline-none focus-visible:shadow-button-neutral-focus"
    >
      <Code as="span" variant="label" className="truncate text-current">
        {decision.run_name}
      </Code>
      <Icon name="externalLinkLine" className="size-14 shrink-0" aria-hidden="true" />
    </Link>
  );
}

function EventPayload({payload}: {payload: string}) {
  const data = [{language: 'json', filename: 'payload.json', code: payload}];

  return (
    <Collapsible defaultOpen>
      <section aria-labelledby="trigger-event-payload-heading" className="flex flex-col gap-8">
        <div className="flex items-center justify-between gap-10">
          <Text id="trigger-event-payload-heading" size="sm" bold>
            Payload
          </Text>
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="transparentMuted"
              size="2xs"
              iconLeft="arrowDownSLine"
              aria-label="Toggle payload"
            />
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent>
          <CodeBlock
            data={data}
            className="flex h-auto max-h-[min(360px,45vh)] flex-col rounded-8 bg-background-contrast-base shadow-none"
          >
            <CodeBlockHeader className="shrink-0 border-b border-border-contrast-base bg-background-contrast-base px-10 py-6">
              <CodeBlockFiles>
                {(item) => (
                  <CodeBlockFilename value={item.filename}>{item.filename}</CodeBlockFilename>
                )}
              </CodeBlockFiles>
              <CodeBlockCopyButton />
            </CodeBlockHeader>
            <CodeBlockBody className="min-h-0 overflow-auto scrollbar">
              {(item) => (
                <CodeBlockItem
                  value={item.filename}
                  lineNumbers={false}
                  className="px-0 pb-0 [&>div]:rounded-none [&>div]:border-0 [&>div]:bg-background-contrast-base [&>div]:dark:bg-background-contrast-base [&_code]:!text-foreground-neutral-on-inverted"
                >
                  <CodeBlockContent language="json" syntaxHighlighting={false}>
                    {item.code}
                  </CodeBlockContent>
                </CodeBlockItem>
              )}
            </CodeBlockBody>
          </CodeBlock>
        </CollapsibleContent>
      </section>
    </Collapsible>
  );
}

function CodeValue({children}: {children: ReactNode}) {
  return (
    <Code as="span" variant="label" className="truncate text-foreground-neutral-muted">
      {children}
    </Code>
  );
}

function MutedDash() {
  return <span className="text-foreground-neutral-disabled">-</span>;
}
