// Bundles the compiler and MJML into `dist/`, so the published package has no runtime
// dependencies. MJML's CSS tooling would otherwise fill the optional peers of other
// packages in a consumer's graph and give it a second copy of each one.
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {readdir, rm, writeFile} from 'node:fs/promises';
import {dirname, join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(packageDir, 'dist');
const licensesFile = 'third-party-licenses.txt';
const licenseFileName = /^licen[cs]e/i;
const htmlnanoSpecifier = /^htmlnano$/;
const anyPath = /.*/;

// esbuild leaves a `require` or `import()` with a computed name in place and logs it at
// debug level. The bundle cannot resolve it at run time, so each one fails the build
// unless it is listed here.
const unresolvedRequireIds = ['unsupported-require-call', 'unsupported-dynamic-import'];
const allowedUnresolvedRequires = new Set([
  // Loads a `skeleton` path option. The compiler never passes one.
  'mjml-core/lib/node-only/skeleton-loader.js',
  // Loads `.mjmlconfig` files and the components they list. The compiler sets neither
  // `useMjmlConfigOptions` nor `mjmlConfigPath`.
  'mjml-core/lib/helpers/mjmlconfig.js',
]);

// MJML only calls htmlnano with `minify: true`, which the compiler never passes. htmlnano
// imports its optional minifiers by computed name, so it is replaced rather than bundled.
const htmlnanoStub = {
  name: 'htmlnano-stub',
  setup(pluginBuild) {
    pluginBuild.onResolve({filter: htmlnanoSpecifier}, () => ({
      path: 'htmlnano',
      namespace: 'stub',
    }));
    pluginBuild.onLoad({filter: anyPath, namespace: 'stub'}, () => ({
      contents:
        "module.exports = {process() { throw new Error('@shipfox/email-compiler does not support the MJML minify option'); }};",
      loader: 'js',
    }));
  },
};

// CommonJS dependencies call `require`, which an ES module does not have.
const createRequireBanner = [
  "import {createRequire as __shipfoxCreateRequire} from 'node:module';",
  'const require = __shipfoxCreateRequire(import.meta.url);',
].join('\n');

await removePreviousOutput();

const result = await build({
  absWorkingDir: packageDir,
  entryPoints: ['src/index.ts', 'src/cli.ts'],
  outdir: 'dist',
  bundle: true,
  // Both entries share the compiler chunk. Chunks stay directly in `dist/`, because the
  // compiler finds `partials/` relative to its own module.
  splitting: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  legalComments: 'eof',
  metafile: true,
  banner: {js: createRequireBanner},
  plugins: [htmlnanoStub],
  tsconfigRaw: {},
  logOverride: Object.fromEntries(unresolvedRequireIds.map((id) => [id, 'warning'])),
  logLevel: 'silent',
}).catch((error) => {
  if (error.errors === undefined) throw error;
  throw new Error(`The email compiler bundle failed:\n${error.errors.map(describe).join('\n')}`, {
    cause: error,
  });
});

const unexpected = result.warnings.filter((warning) => !isAllowed(warning));
if (unexpected.length > 0) {
  throw new Error(
    `The email compiler bundle has warnings:\n${unexpected.map(describe).join('\n')}`,
  );
}

await writeFile(
  join(outDir, licensesFile),
  thirdPartyLicenses(Object.keys(result.metafile.inputs)),
);

async function removePreviousOutput() {
  if (!existsSync(outDir)) return;
  const files = await readdir(outDir);
  await Promise.all(
    files
      .filter((file) => file.endsWith('.js') || file === licensesFile)
      .map((file) => rm(join(outDir, file))),
  );
}

function isAllowed(warning) {
  if (!unresolvedRequireIds.includes(warning.id) || warning.location === null) return false;
  return allowedUnresolvedRequires.has(packagePath(warning.location.file));
}

// The path inside the innermost `node_modules`, for example `mjml-core/lib/index.js`.
// esbuild reports paths with forward slashes on every platform.
function packagePath(file) {
  const marker = 'node_modules/';
  return file.slice(file.lastIndexOf(marker) + marker.length);
}

function thirdPartyLicenses(inputs) {
  const packages = new Map();
  for (const input of inputs) {
    if (!input.includes('node_modules')) continue;
    const root = packageRoot(join(packageDir, input));
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    packages.set(`${manifest.name}@${manifest.version}`, {root, manifest});
  }

  const sections = [...packages.keys()].sort().map((id) => {
    const {root, manifest} = packages.get(id);
    const licenseFile = readdirSync(root).find((file) => licenseFileName.test(file));
    const text = licenseFile
      ? readFileSync(join(root, licenseFile), 'utf8').trim()
      : `License: ${manifest.license ?? 'not declared'}`;
    return `${id}\n\n${text}`;
  });
  return `@shipfox/email-compiler bundles the following packages.\n\n${sections.join(`\n\n${'-'.repeat(80)}\n\n`)}\n`;
}

// The nearest directory with a named `package.json`. Some packages nest a
// `package.json` without a name, for example to set the module type of a subdirectory.
function packageRoot(file) {
  let directory = dirname(file);
  while (true) {
    const manifestPath = join(directory, 'package.json');
    if (existsSync(manifestPath) && JSON.parse(readFileSync(manifestPath, 'utf8')).name) {
      return directory;
    }
    const parent = dirname(directory);
    if (parent === directory)
      throw new Error(`No package.json above ${relative(packageDir, file)}`);
    directory = parent;
  }
}

function describe({text, location}) {
  return location === null ? `- ${text}` : `- ${location.file}:${location.line}: ${text}`;
}
