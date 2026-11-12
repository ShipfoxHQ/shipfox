import {readFileSync} from 'node:fs';
import {mkdir, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {basename, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import mjml2html from 'mjml';

// `partials/` lives at the package root, sibling to both `src/` and `dist/`.
const partialsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'partials');

const sharedPartialInclude =
  /<mj-include\s+path="@shipfox\/email-compiler\/partials\/([^"]*)"\s*(?:\/>|>\s*<\/mj-include>)/g;

// Components whose body is HTML content, not MJML children. Handlebars runs on the
// compiled HTML, so a block helper inside them works as written.
const contentComponents =
  'mj-raw|mj-text|mj-table|mj-button|mj-title|mj-preview|mj-style|mj-accordion-title|mj-accordion-text|mj-navbar-link|mj-social-element';
const contentComponent = new RegExp(`<(${contentComponents})\\b[^>]*>[\\s\\S]*?</\\1>`, 'g');
const partialFileName = /^[\w-]+\.mjml$/;
const blockHelper = /\{\{~?\s*(?:[#^/]|else\b)[^}]*\}\}/;
const templateExtension = '.mjml';
const outputExtension = '.hbs';

export class EmailCompileError extends Error {
  readonly templateName: string;

  constructor(templateName: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'EmailCompileError';
    this.templateName = templateName;
  }
}

function inlineSharedPartials(templateName: string, source: string): string {
  return source.replace(sharedPartialInclude, (_include, file: string) => {
    if (!partialFileName.test(file)) {
      throw new EmailCompileError(
        templateName,
        `Invalid shared partial "${file}" in template "${templateName}"`,
      );
    }
    try {
      return readFileSync(join(partialsDir, file), 'utf8');
    } catch (cause) {
      throw new EmailCompileError(
        templateName,
        `Unknown shared partial "@shipfox/email-compiler/partials/${file}" in template "${templateName}"`,
        {cause},
      );
    }
  });
}

// Handlebars runs after MJML, so a block helper between MJML components is dropped
// by the MJML parser and both branches render. Wrapping it in `<mj-raw>` keeps it.
function assertNoBareBlockHelper(templateName: string, source: string): void {
  const bare = source.replace(contentComponent, '').match(blockHelper);
  if (bare) {
    throw new EmailCompileError(
      templateName,
      `Handlebars block helper "${bare[0]}" sits between MJML components in template "${templateName}" and would be silently dropped. Wrap it in <mj-raw>.`,
    );
  }
}

/** Compiles one MJML template file into the Handlebars HTML template that `@shipfox/node-email` renders. */
export async function compileEmailTemplate(params: {filePath: string}): Promise<string> {
  const name = basename(params.filePath, templateExtension);
  const source = await readFile(params.filePath, 'utf8');
  const inlined = inlineSharedPartials(name, source);
  assertNoBareBlockHelper(name, inlined);

  const {html, errors} = await mjml2html(inlined, {
    filePath: params.filePath,
    ignoreIncludes: false,
  });
  if (errors.length > 0) {
    throw new EmailCompileError(
      name,
      `Invalid MJML in template "${name}": ${JSON.stringify(errors)}`,
    );
  }
  return html;
}

/**
 * Compiles every `<name>.mjml` file directly in `sourceDir` into `<name>.hbs` in `outDir`.
 * Subdirectories are skipped, so a package can keep its own partials in one. Outputs whose
 * source template no longer exists are removed, so a deleted template does not keep shipping.
 */
export async function compileEmailTemplates(params: {
  sourceDir: string;
  outDir: string;
}): Promise<string[]> {
  const entries = await readdir(params.sourceDir, {withFileTypes: true});
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(templateExtension))
    .map((entry) => entry.name)
    .sort();

  await mkdir(params.outDir, {recursive: true});
  const names: string[] = [];
  for (const file of files) {
    const html = await compileEmailTemplate({filePath: join(params.sourceDir, file)});
    const name = basename(file, templateExtension);
    await writeFile(join(params.outDir, `${name}${outputExtension}`), html);
    names.push(name);
  }

  const current = new Set(names.map((name) => `${name}${outputExtension}`));
  const stale = (await readdir(params.outDir)).filter(
    (file) => file.endsWith(outputExtension) && !current.has(file),
  );
  await Promise.all(stale.map((file) => rm(join(params.outDir, file))));
  return names;
}
