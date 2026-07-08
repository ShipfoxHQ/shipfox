import type {MetadataRoute} from 'next';

import {source} from '@/lib/source';
import {toUrl} from '@/url';

export const revalidate = false;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const docsPages = await source.getPages();
  const docsPagesSitemap: MetadataRoute.Sitemap = docsPages.map((page) => ({
    url: toUrl(page.url),
    changeFrequency: 'weekly',
    priority: page.url === '/' ? 1.0 : 0.8,
  }));
  return docsPagesSitemap;
}
