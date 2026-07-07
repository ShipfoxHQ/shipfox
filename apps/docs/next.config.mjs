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
};

export default withMDX(config);
