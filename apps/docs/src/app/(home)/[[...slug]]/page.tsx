import {createRelativeLink} from 'fumadocs-ui/mdx';
import {DocsBody, DocsDescription, DocsPage, DocsTitle} from 'fumadocs-ui/page';
import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {EventReference, eventReferenceToc} from '@/app/components/event-reference/event-reference';
import {PageFeedback} from '@/app/components/page-feedback';
import {ToolReference, toolReferenceToc} from '@/app/components/tool-reference/tool-reference';
import {getEventReferenceDocument} from '@/lib/event-reference-source';
import {buildPageMetadata} from '@/lib/page-metadata';
import {source} from '@/lib/source';
import {getToolReferenceDocument} from '@/lib/tool-reference-source';
import {getMDXComponents} from '@/mdx-components';

export default async function Page(props: {params: Promise<{slug?: string[]}>}) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDXContent = page.data.body;
  // Reference pages render their catalog from a generated document, so the
  // page supplies the catalog's TOC entries and keeps the TOC on the wider
  // layout that Fumadocs would otherwise drop for full-width pages.
  const toolReference = page.data.toolReference
    ? getToolReferenceDocument(page.data.toolReference)
    : undefined;
  const eventReference = page.data.eventReference
    ? getEventReferenceDocument(page.data.eventReference)
    : undefined;
  const reference = Boolean(toolReference || eventReference);
  const toc = [
    ...page.data.toc,
    ...(toolReference ? toolReferenceToc(toolReference) : []),
    ...(eventReference ? eventReferenceToc(eventReference) : []),
  ];

  return (
    <DocsPage
      toc={toc}
      full={page.data.full || reference}
      tableOfContent={
        reference ? {enabled: true} : {enabled: page.data.tableOfContent ?? !page.data.full}
      }
    >
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDXContent
          components={getMDXComponents({
            a: createRelativeLink(source, page),
            ...(toolReference
              ? {ToolReference: () => <ToolReference document={toolReference} />}
              : {}),
            ...(eventReference
              ? {EventReference: () => <EventReference document={eventReference} />}
              : {}),
          })}
        />
        <PageFeedback pageUrl={page.url} filePath={page.path} />
      </DocsBody>
    </DocsPage>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: {
  params: Promise<{slug?: string[]}>;
}): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  return buildPageMetadata(page);
}
