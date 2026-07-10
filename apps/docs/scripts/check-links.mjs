import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const docsRoot = fileURLToPath(new URL('..', import.meta.url));
const contentRoot = path.join(docsRoot, 'content', 'docs');
const internalLinkPattern = /(?:\]\(|href=["'])((?:\/|#)[^)"'\s]+)(?:\)|["'])/g;
const mdxExtensionPattern = /\.mdx$/;
const headingPattern = /^#{1,6}\s+(.+?)\s*#*\s*$/gm;
const pages = (await filesUnder(contentRoot)).filter((file) => file.endsWith('.mdx'));
const routes = new Set(pages.map(routeFor));
const anchorsByRoute = new Map(
  await Promise.all(
    pages.map(async (file) => {
      const content = await readFile(file, 'utf8');
      return [routeFor(file), anchorsFor(content)];
    }),
  ),
);
const violations = [];

for (const file of pages) {
  const content = await readFile(file, 'utf8');
  for (const match of content.matchAll(internalLinkPattern)) {
    const target = match[1];
    if (!target || target.startsWith('/img/')) continue;
    const [targetRoute, encodedAnchor] = target.split('#', 2);
    const route = targetRoute || routeFor(file);
    if (!routes.has(route)) {
      violations.push(`${path.relative(docsRoot, file)} -> ${target}`);
      continue;
    }
    if (encodedAnchor && !anchorsByRoute.get(route)?.has(decodeURIComponent(encodedAnchor))) {
      violations.push(`${path.relative(docsRoot, file)} -> ${target} (missing heading)`);
    }
  }
}

if (violations.length > 0) {
  process.stderr.write(
    `Internal documentation links target missing pages or headings:\n${violations.join('\n')}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write('All internal documentation links target existing pages.\n');
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
  const counts = new Map();

  for (const match of content.matchAll(headingPattern)) {
    const heading = match[1];
    if (!heading) continue;
    const base = slugForHeading(heading);
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }

  return anchors;
}

function slugForHeading(heading) {
  return heading
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[`*_~]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
    .replace(/\s+/g, '-');
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
