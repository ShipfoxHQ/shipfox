import type {MetadataRoute} from 'next';
import {basePath, toUrl} from '@/url';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: `${basePath}/mcp.mdx/`,
    },
    sitemap: toUrl('/sitemap.xml'),
  };
}
