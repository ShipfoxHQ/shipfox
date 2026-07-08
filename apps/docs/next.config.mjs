import {fileURLToPath} from 'node:url';
import {createMDX} from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // Served behind the cloud landing app at www.shipfox.io/docs.
  basePath: '/docs',
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
  // Everything lives under the basePath, so the deployment domain root (the URL
  // Vercel puts in the PR preview comment) would 404. Redirect it to /docs.
  // basePath:false matches the literal domain root, before the prefix is applied.
  // In production only /docs/* is proxied from the landing app, so this never runs there.
  redirects() {
    return [{source: '/', destination: '/docs', basePath: false, permanent: false}];
  },
};

export default withMDX(config);
