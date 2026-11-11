import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import handlebars, {type TemplateDelegate} from 'handlebars';
import {config} from './config.js';
import {EmailTemplateError} from './errors.js';

// The logo asset is served at /email-logo.png by every client composed with
// @shipfox/client-shell (libs/client/shell/assets/email-logo.png), so its URL is
// built from the deployment's CLIENT_BASE_URL and resolved once at module load.
const logoUrl = new URL('/email-logo.png', config.CLIENT_BASE_URL).toString();

const controlCharacters = /\p{Cc}+/gu;

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
  /** Directory holding one `<name>.hbs` file per template, compiled by `shipfox-email-compile`. */
  templatesDir: string;
  templates: {[Name in keyof Templates]: EmailTemplateDefinition<Templates[Name]>};
}

export type EmailRenderer<Templates extends object> = <Name extends keyof Templates & string>(
  name: Name,
  data: Templates[Name],
) => Promise<RenderedEmail>;

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

    const path = join(templatesDir, `${name}.hbs`);
    let html: string;
    try {
      html = await readFile(path, 'utf8');
    } catch (cause) {
      throw new EmailTemplateError(
        name,
        `Compiled email template not found: ${path}. Compile the .mjml sources with shipfox-email-compile.`,
        {cause},
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
