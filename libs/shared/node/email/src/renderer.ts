import {readFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import handlebars, {type TemplateDelegate} from 'handlebars';
import mjml2html from 'mjml';
import {config} from './config.js';
import {EmailTemplateError} from './errors.js';

// `emails/` lives at the package root, sibling to both `src/` and `dist/`, so
// this resolves to the same directory whether the code runs from source
// (dev/test) or from the compiled bundle (prod).
const partialsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'emails', 'partials');

// The logo asset is served at /email-logo.png by every client composed with
// @shipfox/client-shell (libs/client/shell/assets/email-logo.png), so its URL is
// built from the deployment's CLIENT_BASE_URL and resolved once at module load.
const logoUrl = new URL('/email-logo.png', config.CLIENT_BASE_URL).toString();

const sharedPartialInclude =
  /<mj-include\s+path="@shipfox\/node-email\/partials\/([^"]*)"\s*(?:\/>|>\s*<\/mj-include>)/g;

// Components whose body is HTML content, not MJML children. Handlebars runs on the
// rendered HTML, so a block helper inside them works as written.
const contentComponents =
  'mj-raw|mj-text|mj-table|mj-button|mj-title|mj-preview|mj-style|mj-accordion-title|mj-accordion-text|mj-navbar-link|mj-social-element';
const contentComponent = new RegExp(`<(${contentComponents})\\b[^>]*>[\\s\\S]*?</\\1>`, 'g');
const partialFileName = /^[\w-]+\.mjml$/;
const controlCharacters = /\p{Cc}+/gu;
const blockHelper = /\{\{~?\s*(?:[#^/]|else\b)[^}]*\}\}/;

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface EmailTemplateDefinition<Data> {
  /** Handlebars source for the subject line. It is not HTML-escaped. */
  subject: string;
  /** Plain-text alternative. Receives the sanitised data. */
  text: (data: Data) => string;
}

export interface EmailRendererOptions<Templates extends object> {
  /** Directory holding one `<name>.mjml` file per template. */
  templatesDir: string;
  templates: {[Name in keyof Templates]: EmailTemplateDefinition<Templates[Name]>};
}

export type EmailRenderer<Templates extends object> = <Name extends keyof Templates & string>(
  name: Name,
  data: Templates[Name],
) => Promise<RenderedEmail>;

function inlineSharedPartials(templateName: string, source: string): string {
  return source.replace(sharedPartialInclude, (_include, file: string) => {
    if (!partialFileName.test(file)) {
      throw new EmailTemplateError(
        templateName,
        `Invalid shared partial "${file}" in template "${templateName}"`,
      );
    }
    try {
      return readFileSync(join(partialsDir, file), 'utf8');
    } catch (cause) {
      throw new EmailTemplateError(
        templateName,
        `Unknown shared partial "@shipfox/node-email/partials/${file}" in template "${templateName}"`,
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
    throw new EmailTemplateError(
      templateName,
      `Handlebars block helper "${bare[0]}" sits between MJML components in template "${templateName}" and would be silently dropped. Wrap it in <mj-raw>.`,
    );
  }
}

function sanitizeDisplayValue(value: string): string {
  // Collapse any run of control characters (newlines, tabs, etc.) to a single
  // space and trim. User-controlled display names (workspace, inviter) reach the
  // subject line and the plain-text body, where a raw newline could fold the
  // subject or inject a fake CTA / phishing link as its own line. The boundary
  // schemas reject these names; this is the render-time net for any that slip in.
  return value.replace(controlCharacters, ' ').trim();
}

function sanitizeDisplayValues<Value>(value: Value): Value {
  if (typeof value === 'string') return sanitizeDisplayValue(value) as Value;
  if (Array.isArray(value)) return value.map(sanitizeDisplayValues) as Value;
  if (
    value !== null &&
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, sanitizeDisplayValues(entry)]),
    ) as Value;
  }
  return value;
}

export function createEmailRenderer<Templates extends object>(
  options: EmailRendererOptions<Templates>,
): EmailRenderer<Templates> {
  const {templatesDir, templates} = options;
  const htmlTemplates = new Map<string, TemplateDelegate>();
  const subjectTemplates = new Map<string, TemplateDelegate>();

  async function getHtmlTemplate(name: string): Promise<TemplateDelegate> {
    const cached = htmlTemplates.get(name);
    if (cached) return cached;

    const path = join(templatesDir, `${name}.mjml`);
    let source: string;
    try {
      source = await readFile(path, 'utf8');
    } catch (cause) {
      throw new EmailTemplateError(name, `Email template file not found: ${path}`, {cause});
    }

    const inlined = inlineSharedPartials(name, source);
    assertNoBareBlockHelper(name, inlined);

    const {html, errors} = await mjml2html(inlined, {filePath: path, ignoreIncludes: false});
    if (errors.length > 0) {
      throw new EmailTemplateError(
        name,
        `Invalid MJML in template "${name}": ${JSON.stringify(errors)}`,
      );
    }

    const template = handlebars.compile(html);
    htmlTemplates.set(name, template);
    return template;
  }

  function getSubjectTemplate(name: string, subject: string): TemplateDelegate {
    const cached = subjectTemplates.get(name);
    if (cached) return cached;

    // Subjects are plain text, not HTML, so compile them with `noEscape` to keep a
    // workspace name like `A&B` from turning into `A&amp;B` in the subject line.
    const template = handlebars.compile(subject, {noEscape: true});
    subjectTemplates.set(name, template);
    return template;
  }

  return async (name, data) => {
    if (!Object.hasOwn(templates, name)) {
      throw new EmailTemplateError(name, `Unknown email template "${name}"`);
    }
    const definition = templates[name];
    const htmlTemplate = await getHtmlTemplate(name);
    const subjectTemplate = getSubjectTemplate(name, definition.subject);
    const safe = sanitizeDisplayValues(data);

    return {
      subject: subjectTemplate(safe),
      html: htmlTemplate({...safe, logoUrl}),
      text: definition.text(safe),
    };
  };
}
