import type {TOCItemType} from 'fumadocs-core/toc';
import {EventFamily} from '@/app/components/event-reference/event-family';
import type {EventReferenceDocument} from '@/lib/event-reference/document';

export function EventReference({document}: {document: EventReferenceDocument}) {
  return (
    <div className="not-prose @container flex flex-col gap-y-section">
      <SummaryStrip document={document} />
      {document.passthrough && document.upstreamEventsDocUrl ? (
        <p className="text-sm text-fd-muted-foreground">
          Shipfox also delivers {document.provider} events that are not listed here. See{' '}
          <a
            className="text-fd-primary underline-offset-2 hover:underline"
            href={document.upstreamEventsDocUrl}
            rel="noreferrer"
          >
            every {document.provider} event
          </a>
          .
        </p>
      ) : null}
      <div className="flex flex-col">
        {document.families.map((family) => (
          <EventFamily document={document} family={family} key={family.anchor} />
        ))}
      </div>
    </div>
  );
}

function SummaryStrip({document}: {document: EventReferenceDocument}) {
  const reference = document.upstreamEventsDocUrl ?? document.families[0]?.payloadDocUrl;
  const groupCount = `in ${document.families.length} ${document.families.length === 1 ? 'group' : 'groups'}`;
  return (
    <dl className="grid grid-cols-1 overflow-hidden rounded-lg border border-fd-border bg-fd-card @min-[40rem]:grid-cols-2">
      <SummaryCell label="Events">
        <span className="text-lg font-semibold text-fd-foreground">{document.eventCount}</span>
        <span className="text-sm text-fd-muted-foreground">{groupCount}</span>
      </SummaryCell>
      <SummaryCell label="Learn more">
        {reference ? (
          <a
            className="text-sm font-medium text-fd-primary underline-offset-2 hover:underline"
            href={reference}
            rel="noreferrer"
          >
            {document.provider} event fields
          </a>
        ) : (
          <span className="text-sm text-fd-muted-foreground">Fields appear below.</span>
        )}
      </SummaryCell>
    </dl>
  );
}

function SummaryCell({label, children}: {label: string; children: React.ReactNode}) {
  return (
    <div className="flex flex-col gap-y-tight border-fd-border border-b px-row py-row last:border-b-0 @min-[40rem]:border-r @min-[40rem]:border-b-0 @min-[40rem]:last:border-r-0">
      <dt className="text-[11px] font-medium uppercase tracking-wider text-fd-muted-foreground">
        {label}
      </dt>
      <dd className="flex flex-wrap items-center gap-x-inline">{children}</dd>
    </div>
  );
}

/** Table of contents entries for the families and events of a document. */
export function eventReferenceToc(document: EventReferenceDocument): TOCItemType[] {
  return document.families.flatMap((family) => [
    {title: family.title, url: `#${family.anchor}`, depth: 3},
    ...family.events.map((event) => ({
      title: (
        <span className="break-all font-mono text-xs" key={event.anchor}>
          {event.name}
        </span>
      ),
      url: `#${event.anchor}`,
      depth: 4,
    })),
  ]);
}
