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

// Set from `basePath` in next.config.mjs (via NEXT_PUBLIC_BASE_PATH): `/docs` in
// production, empty in local dev. Every absolute URL we emit for external consumers
// (llms.txt, sitemap, robots, OG metadata) must carry the prefix; Next only applies
// basePath to in-app routing, not to strings we build ourselves.
export const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export const toUrl = (path: string) => {
  const suffix = path === '/' ? '' : path;
  return new URL(`${basePath}${suffix}`, url).toString();
};
