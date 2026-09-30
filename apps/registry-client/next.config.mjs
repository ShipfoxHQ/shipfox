import {fileURLToPath} from 'node:url';

const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url));

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // Served under www.shipfox.io/registry, next to the docs at /docs.
  basePath: '/registry',
  // The Docker image ships the standalone server. On Vercel the platform adapter packages the
  // build, and running standalone after it fails on a missing next-server.js.nft.json.
  output: process.env.VERCEL ? undefined : 'standalone',
  // Trace workspace packages from the repository root so the standalone server includes them.
  outputFileTracingRoot: workspaceRoot,
  // Pin the workspace root so Turbopack does not misinfer it from sibling lockfiles
  // (git worktrees expose more than one pnpm-workspace.yaml).
  turbopack: {
    root: workspaceRoot,
  },
  poweredByHeader: false,
  // Tests are type-checked by the `type` task, with the test runner's globals.
  typescript: {tsconfigPath: 'tsconfig.build.json'},
  redirects() {
    // basePath:false matches the literal host root, which would otherwise 404.
    return [{source: '/', destination: '/registry', basePath: false, permanent: false}];
  },
};

export default config;
