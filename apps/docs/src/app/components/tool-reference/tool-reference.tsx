import type {TOCItemType} from 'fumadocs-core/toc';
import {AccessBadge} from '@/app/components/tool-reference/access-badge';
import {ToolOperation} from '@/app/components/tool-reference/tool-operation';
import type {ToolReferenceDocument} from '@/lib/tool-reference/document';

export function ToolReference({document}: {document: ToolReferenceDocument}) {
  return (
    <div className="not-prose flex flex-col gap-y-region">
      {document.groups.map((group) => (
        <section className="flex flex-col" key={group.anchor}>
          <h3
            className="scroll-mt-24 border-fd-border border-b pb-inline text-xs font-medium uppercase tracking-wider text-fd-muted-foreground"
            id={group.anchor}
          >
            {group.title}
          </h3>
          {group.tools.map((tool) => (
            <ToolOperation document={document} key={tool.anchor} tool={tool} />
          ))}
        </section>
      ))}
    </div>
  );
}

/** Table of contents entries for the groups and tools of a document. */
export function toolReferenceToc(document: ToolReferenceDocument): TOCItemType[] {
  return document.groups.flatMap((group) => [
    {title: group.title, url: `#${group.anchor}`, depth: 3},
    ...group.tools.map((tool) => ({
      title: (
        <span className="inline-flex items-center gap-x-inline" key={tool.anchor}>
          <AccessBadge access={tool.access} compact />
          <span className="break-all font-mono text-xs">{tool.id}</span>
        </span>
      ),
      url: `#${tool.anchor}`,
      depth: 4,
    })),
  ]);
}
