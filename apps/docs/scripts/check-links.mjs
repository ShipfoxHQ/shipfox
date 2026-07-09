import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const docsRoot = fileURLToPath(new URL('..', import.meta.url));
const contentRoot = path.join(docsRoot, 'content', 'docs');
const internalLinkPattern = /(?:\]\(|href=["'])(\/[^)"'\s]+)(?:\)|["'])/g;
const mdxExtensionPattern = /\.mdx$/;
const pages = (await filesUnder(contentRoot)).filter((file) => file.endsWith('.mdx'));
const routes = new Set(pages.map(routeFor));
const violations = [];

for (const file of pages) {
  const content = await readFile(file, 'utf8');
  for (const match of content.matchAll(internalLinkPattern)) {
    const target = match[1];
    if (!target || target.startsWith('/img/')) continue;
    const route = target.split('#', 1)[0];
    if (route && !routes.has(route)) {
      violations.push(`${path.relative(docsRoot, file)} -> ${target}`);
    }
  }
}

if (violations.length > 0) {
  process.stderr.write(
    `Internal documentation links target missing pages:\n${violations.join('\n')}\n`,
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
