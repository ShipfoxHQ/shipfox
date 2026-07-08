import {createRelativeLink} from 'fumadocs-ui/mdx';
import {DocsBody, DocsDescription, DocsPage, DocsTitle} from 'fumadocs-ui/page';
import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {source} from '@/lib/source';
import {getMDXComponents} from '@/mdx-components';
import {toUrl, url} from '@/url';

export default async function Page(props: {params: Promise<{slug?: string[]}>}) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDXContent = page.data.body;

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDXContent
          components={getMDXComponents({
            a: createRelativeLink(source, page),
          })}
        />
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

  // Built here (not in the parent layout) because only the page segment sees the
  // real slug, so each page gets its own OG image. toUrl carries the /docs
  // basePath, which Next does not apply to manually built metadata URLs.
  const title = `${page.data.title} | Shipfox`;
  const image = toUrl(['/docs-og', ...(params.slug ?? []), 'image.png'].join('/'));
  return {
    title,
    description: page.data.description,
    metadataBase: new URL(url),
    openGraph: {
      title,
      description: page.data.description,
      images: image,
      siteName: 'Shipfox',
      type: 'website',
      locale: 'en_US',
    },
    twitter: {
      card: 'summary_large_image',
      images: image,
    },
  };
}
