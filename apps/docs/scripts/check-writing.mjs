import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const docsRoot = fileURLToPath(new URL('..', import.meta.url));
const files = [
  ...(await filesUnder(path.join(docsRoot, 'content', 'docs'))),
  path.join(docsRoot, 'WRITING.md'),
  path.join(docsRoot, '..', '..', 'WRITING.md'),
];

const violations = [];
for (const file of files) {
  const content = await readFile(file, 'utf8');
  content.split('\n').forEach((line, index) => {
    if (line.includes('\u2014')) violations.push(`${path.relative(docsRoot, file)}:${index + 1}`);
  });
}

if (violations.length > 0) {
  process.stderr.write(`Unicode em dash (U+2014) is not allowed:\n${violations.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('No Unicode em dashes found in documentation.\n');
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
