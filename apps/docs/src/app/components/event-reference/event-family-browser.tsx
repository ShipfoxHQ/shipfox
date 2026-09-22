'use client';

import {type ReactNode, useEffect, useState} from 'react';

export interface EventFamilyBrowserEvent {
  name: string;
  anchor: string;
  summary: string;
}

// Selecting a row swaps the code panel to that event's examples. The panels are
// rendered on the server and handed over as nodes, so the client only holds the
// selection.
export function EventFamilyBrowser({
  events,
  panels,
  children,
}: {
  events: EventFamilyBrowserEvent[];
  panels: ReactNode[];
  children: ReactNode;
}) {
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    const selectFromHash = () => {
      const anchor = decodeURIComponent(window.location.hash.slice(1));
      const index = events.findIndex((event) => event.anchor === anchor);
      if (index >= 0) setSelected(index);
    };
    selectFromHash();
    window.addEventListener('hashchange', selectFromHash);
    return () => window.removeEventListener('hashchange', selectFromHash);
  }, [events]);

  return (
    <div className="grid grid-cols-1 items-start gap-section @min-[48rem]:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
      <div className="flex flex-col gap-y-group">
        <div className="flex flex-col gap-y-inline">
          <h4 className="border-fd-border border-b pb-inline text-xs font-medium uppercase tracking-wider text-fd-muted-foreground">
            Events
          </h4>
          <div className="overflow-hidden rounded-lg border border-fd-border bg-fd-card">
            {events.map((event, index) => {
              const active = index === selected;
              return (
                <button
                  aria-pressed={active}
                  className={`w-full scroll-mt-24 border-fd-border border-b border-l-2 px-row py-inline text-left last:border-b-0 ${active ? 'border-l-fd-primary bg-fd-accent' : 'border-l-transparent hover:bg-fd-accent/60'}`}
                  id={event.anchor}
                  key={event.anchor}
                  onClick={() => setSelected(index)}
                  type="button"
                >
                  <span className="flex flex-col gap-y-tight">
                    <code className="font-mono text-[13px] font-bold text-fd-foreground">
                      {event.name}
                    </code>
                    <span className="text-sm text-fd-muted-foreground">{event.summary}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        {children}
      </div>
      <aside className="@min-[48rem]:sticky @min-[48rem]:top-[calc(var(--fd-docs-row-1,3.5rem)+1rem)]">
        {panels[selected] ?? panels[0]}
      </aside>
    </div>
  );
}
