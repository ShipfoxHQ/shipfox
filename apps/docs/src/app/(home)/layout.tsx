import {DocsLayout} from 'fumadocs-ui/layouts/docs';
import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import type {ReactNode} from 'react';
import {SidebarFooter} from '@/app/components/sidebar-footer';
import {baseOptions} from '@/app/layout.config';
import {source} from '@/lib/source';
import {url} from '@/url';

export async function generateMetadata({params}: {params: Promise<{slug?: string[]}>}) {
  const {slug = []} = await params;
  const page = source.getPage(slug);
  if (!page) notFound();
  const image = ['/docs-og', ...slug, 'image.png'].join('/');
  return {
    title: `${page.data.title} | Shipfox`,
    description: page.data.description,
    metadataBase: new URL(url),
    openGraph: {
      images: image,
      title: `${page.data.title} | Shipfox`,
      description: page.data.description,
      siteName: 'Shipfox',
      type: 'website',
      locale: 'en_US',
    },
    twitter: {
      card: 'summary_large_image',
      images: image,
    },
  } as Metadata;
}

export default function Layout({children}: {children: ReactNode}) {
  return (
    <DocsLayout
      tree={source.pageTree}
      sidebar={{
        footer: <SidebarFooter />,
      }}
      {...baseOptions}
    >
      {/* @ts-ignore: fuma-docs and monorepo react versions seem to be incompatible */}
      {children}
    </DocsLayout>
  );
}
