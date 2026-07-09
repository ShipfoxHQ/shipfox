import {fileURLToPath} from 'node:url';
import {createMDX} from 'fumadocs-mdx/next';

const withMDX = createMDX();

// The production docs deployment is mounted behind the cloud landing app at
// www.shipfox.io/docs. Vercel previews stay rooted at / so preview URLs work
// directly from the generated deployment URL.
const basePath = process.env.VERCEL_ENV === 'production' ? '/docs' : '';

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  basePath: basePath || undefined,
  env: {NEXT_PUBLIC_BASE_PATH: basePath},
  // Pin the workspace root so Turbopack does not misinfer it from sibling lockfiles
  // (git worktrees expose more than one pnpm-workspace.yaml).
  turbopack: {
    root: fileURLToPath(new URL('../..', import.meta.url)),
  },
  rewrites() {
    return [
      {
        source: '/:path*.mdx',
        destination: '/llms.mdx/:path*',
      },
      {
        source: '/:path*.md',
        destination: '/llms.mdx/:path*',
      },
    ];
  },
  redirects() {
    // The old Introduction page merged into the docs root. Redirect it in both
    // environments; Next prefixes the basePath, so in production this matches
    // /docs/introduction -> /docs.
    const rules = [{source: '/introduction', destination: '/', permanent: true}];
    if (!basePath) {
      // In dev there is no basePath, so redirect /docs-prefixed URLs back to the
      // unprefixed route so production URLs copied into a local browser still work.
      rules.push(
        {source: '/docs', destination: '/', permanent: false},
        {source: '/docs/:path*', destination: '/:path*', permanent: false},
      );
    } else {
      // With a basePath, the deployment domain root (the URL Vercel puts in the PR
      // preview comment) would 404, so redirect it to /docs. basePath:false matches
      // the literal domain root, before the prefix is applied.
      rules.push({source: '/', destination: basePath, basePath: false, permanent: false});
    }
    return rules;
  },
};

export default withMDX(config);
