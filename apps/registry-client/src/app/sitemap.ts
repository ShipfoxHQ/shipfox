import type {MetadataRoute} from 'next';
import {registry} from '@/lib/registry';
import {packagePath, publicUrl} from '@/lib/urls';

// Built on request: the registry API is not reachable when the image is built.
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const packages = await registry.listPackages();
  return [
    {url: publicUrl(), changeFrequency: 'daily', priority: 1},
    ...packages.map((entry) => ({
      url: publicUrl(packagePath(entry.package)),
      lastModified: entry.published_at,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
  ];
}
