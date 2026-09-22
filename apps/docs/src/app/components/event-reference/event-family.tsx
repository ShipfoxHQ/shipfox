import {Callout} from 'fumadocs-ui/components/callout';
import {EventFamilyBrowser} from '@/app/components/event-reference/event-family-browser';
import {Chip} from '@/app/components/tool-reference/access-badge';
import {CodePanel} from '@/app/components/tool-reference/code-panel';
import {InlineCodeList} from '@/app/components/tool-reference/inline-code-list';
import {ParameterList} from '@/app/components/tool-reference/parameter-list';
import {Block, Note} from '@/app/components/tool-reference/tool-operation';
import type {EventReferenceDocument, EventReferenceFamily} from '@/lib/event-reference/document';

const SHIPFOX_FIELD_DESCRIPTION_PATTERN = /added by Shipfox/iu;

export function EventFamily({
  family,
  document,
}: {
  family: EventReferenceFamily;
  document: EventReferenceDocument;
}) {
  const eventCount = `${family.events.length} ${family.events.length === 1 ? 'event' : 'events'}`;
  return (
    <section
      className="flex scroll-mt-24 flex-col gap-y-group border-fd-border border-t py-frame"
      id={family.anchor}
    >
      <header className="flex flex-col gap-y-inline">
        <div className="flex flex-wrap items-center gap-x-cluster">
          <a className="no-underline" href={`#${family.anchor}`}>
            <h3 className="text-lg font-semibold text-fd-foreground">{family.title}</h3>
          </a>
          <Chip>{eventCount}</Chip>
        </div>
        <p className="max-w-[70ch] text-fd-foreground">{family.summary}</p>
        {family.notes.map((note) => (
          <Callout className="my-0 max-w-[76ch]" key={note}>
            <InlineCodeList markdown={note} />
          </Callout>
        ))}
      </header>
      <EventFamilyBrowser
        events={family.events.map(({name, anchor, summary}) => ({name, anchor, summary}))}
        panels={family.events.map((event) => (
          <CodePanel examples={event.examples} key={event.anchor} />
        ))}
      >
        <Block title="Payload">
          <PayloadFields document={document} family={family} />
        </Block>
      </EventFamilyBrowser>
    </section>
  );
}

function PayloadFields({
  family,
  document,
}: {
  family: EventReferenceFamily;
  document: EventReferenceDocument;
}) {
  if (family.fields.length === 0) {
    return (
      <Note>
        {document.provider} sends these fields to your workflow. {document.provider} may add fields.{' '}
        {family.payloadDocUrl ? (
          <ProviderReference provider={document.provider} url={family.payloadDocUrl} />
        ) : null}
      </Note>
    );
  }
  const badges = Object.fromEntries(
    family.shipfoxFields
      .filter(
        (name) =>
          !family.fields.some(
            (field) =>
              field.name === name &&
              SHIPFOX_FIELD_DESCRIPTION_PATTERN.test(field.description ?? ''),
          ),
      )
      .map((name) => [name, 'Added by Shipfox']),
  );
  return (
    <div className="flex flex-col gap-y-inline">
      <ParameterList badges={badges} fields={family.fields} />
      {family.openPayload || family.payloadDocUrl ? (
        <Note>
          {family.openPayload
            ? `${document.provider} may send other fields. Your workflow receives them too. `
            : null}
          {family.payloadDocUrl ? (
            <ProviderReference provider={document.provider} url={family.payloadDocUrl} />
          ) : null}
        </Note>
      ) : null}
    </div>
  );
}

function ProviderReference({provider, url}: {provider: string; url: string}) {
  return (
    <a className="text-fd-primary underline-offset-2 hover:underline" href={url} rel="noreferrer">
      See the {provider} docs
    </a>
  );
}
