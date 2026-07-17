import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {GithubSlugger} from './lib/slug.mjs';

const docsRoot = fileURLToPath(new URL('..', import.meta.url));
const contentRoot = path.join(docsRoot, 'content', 'docs');
const generatedRoot = path.join(docsRoot, 'content', 'generated');
const internalLinkPattern = /(?:\]\(|href=["'])((?:\/|#)[^)"'\s]+)(?:\)|["'])/g;
const mdxExtensionPattern = /\.mdx$/;
const headingPattern = /^#{1,6}\s+(.+?)\s*#*\s*$/gm;
const trailingSlashPattern = /\/$/;
const pages = (await filesUnder(contentRoot)).filter((file) => file.endsWith('.mdx'));
const routes = new Set(pages.map(routeFor));
const generatedFragmentsByRoute = new Map([
  ['/reference/model-providers', ['reference/model-providers.mdx']],
  ['/reference/workflow-schema', ['reference/workflow-schema.mdx']],
  ['/integrations/github/events', ['integrations/github/events.mdx']],
  ['/integrations/github/tools', ['integrations/github/tools.mdx']],
  ['/integrations/sentry/events', ['integrations/sentry/events.mdx']],
  ['/integrations/webhooks/events', ['integrations/webhooks/events.mdx']],
]);
const generatedFragments = (await filesUnder(generatedRoot)).filter((file) =>
  file.endsWith('.mdx'),
);
const pageContents = new Map(
  await Promise.all(pages.map(async (file) => [file, await contentFor(file)])),
);
const anchorsByRoute = new Map(
  await Promise.all(
    pages.map(async (file) => [routeFor(file), anchorsFor(pageContents.get(file) ?? '')]),
  ),
);
const violations = [];

for (const file of pages) {
  const content = pageContents.get(file) ?? '';
  for (const match of content.matchAll(internalLinkPattern)) {
    const target = match[1];
    if (!target || target.startsWith('/img/')) continue;
    const [targetRoute, encodedAnchor] = target.split('#', 2);
    const route = normalizeRoute(targetRoute || routeFor(file));
    if (!routes.has(route)) {
      violations.push(`${path.relative(docsRoot, file)} -> ${target}`);
      continue;
    }
    if (encodedAnchor && !anchorsByRoute.get(route)?.has(decodeURIComponent(encodedAnchor))) {
      violations.push(`${path.relative(docsRoot, file)} -> ${target} (missing heading)`);
    }
  }
}

for (const fragment of generatedFragments) {
  const content = await readFile(fragment, 'utf8');
  const anchors = anchorsFor(content);
  for (const match of content.matchAll(internalLinkPattern)) {
    const target = match[1];
    if (!target?.startsWith('#')) continue;
    const anchor = decodeURIComponent(target.slice(1));
    if (!anchors.has(anchor)) {
      violations.push(`${path.relative(docsRoot, fragment)} -> ${target} (missing heading)`);
    }
  }
}

async function contentFor(file) {
  const fragments = generatedFragmentsByRoute.get(routeFor(file)) ?? [];
  const content = await readFile(file, 'utf8');
  const generated = await Promise.all(
    fragments.map(async (fragment) => await readFile(path.join(generatedRoot, fragment), 'utf8')),
  );
  return [content, ...generated].join('\n');
}

if (violations.length > 0) {
  process.stderr.write(
    `Internal documentation links target missing pages or headings:\n${violations.join('\n')}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write('All internal documentation links target existing pages.\n');
}

function normalizeRoute(route) {
  return route === '/' ? route : route.replace(trailingSlashPattern, '');
}

function routeFor(file) {
  const relative = path
    .relative(contentRoot, file)
    .replaceAll(path.sep, '/')
    .replace(mdxExtensionPattern, '');
  if (relative === 'index') return '/';
  return relative.endsWith('/index') ? `/${relative.slice(0, -'/index'.length)}` : `/${relative}`;
}

function anchorsFor(content) {
  const anchors = new Set();
  const slugger = new GithubSlugger();

  for (const match of content.matchAll(headingPattern)) {
    const heading = match[1];
    if (!heading) continue;
    anchors.add(slugger.slug(headingText(heading)));
  }

  return anchors;
}

function headingText(heading) {
  return heading
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/(^|[^\p{Letter}\p{Number}])__([\s\S]+?)__($|[^\p{Letter}\p{Number}])/gu, '$1$2$3')
    .replace(/(^|[^\p{Letter}\p{Number}])_([\s\S]+?)_($|[^\p{Letter}\p{Number}])/gu, '$1$2$3')
    .replace(/[`*~]/g, '');
}

async function filesUnder(directory) {
  const entries = await readdir(directory, {withFileTypes: true});
  const nested = await Promise.all(
    entries.map((entry) => {
      const file = path.join(directory, entry.name);
      return entry.isDirectory() ? filesUnder(file) : [file];
    }),
  );
  return nested.flat();
}
