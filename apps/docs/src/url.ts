let host = 'localhost:3500';
let protocol = 'http';

if (process.env.NEXT_PUBLIC_VERCEL_ENV) {
  protocol = 'https';
  if (
    process.env.NEXT_PUBLIC_VERCEL_ENV === 'production' &&
    process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL
  ) {
    host = process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL;
  } else if (process.env.NEXT_PUBLIC_VERCEL_URL) {
    host = process.env.NEXT_PUBLIC_VERCEL_URL;
  }
}

export const url = `${protocol}://${host}`;

// Keep in sync with `basePath` in next.config.mjs. The app is served behind the
// cloud landing app at /docs, so every absolute URL we emit for external consumers
// (llms.txt, sitemap, robots, OG metadata) must carry the prefix; Next only applies
// basePath to in-app routing, not to strings we build ourselves.
export const basePath = '/docs';

export const toUrl = (path: string) => {
  const suffix = path === '/' ? '' : path;
  return new URL(`${basePath}${suffix}`, url).toString();
};
