import type {MetadataRoute} from 'next';
import {toUrl} from '@/url';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
    },
    sitemap: toUrl('/sitemap.xml'),
  };
}
