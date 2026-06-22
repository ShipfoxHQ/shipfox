import {readFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import handlebars, {type TemplateDelegate} from 'handlebars';
import mjml2html from 'mjml';
import {EmailTemplateError} from './errors.js';
import {renderText, type TemplateName, type TemplateVariables} from './text.js';

// `emails/` lives at the package root, sibling to both `src/` and `dist/`, so
// this resolves to the same directory whether the code runs from source
// (dev/test) or from the compiled bundle (prod).
const emailsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'emails');

// Subjects are plain text, not HTML, so compile them with `noEscape` to keep a
// workspace name like `A&B` from turning into `A&amp;B` in the subject line.
const subjects: Record<TemplateName, string> = {
  'verify-email': 'Verify your email',
  'reset-password': 'Reset your password',
  'workspace-invitation': 'Join {{workspaceName}} on Shipfox',
};

const htmlTemplates = new Map<TemplateName, TemplateDelegate>();
const subjectTemplates = new Map<TemplateName, TemplateDelegate>();

async function getHtmlTemplate(name: TemplateName): Promise<TemplateDelegate> {
  const cached = htmlTemplates.get(name);
  if (cached) return cached;

  const path = join(emailsDir, `${name}.mjml`);
  let source: string;
  try {
    source = await readFile(path, 'utf8');
  } catch (cause) {
    throw new EmailTemplateError(name, `Email template file not found: ${path}`, {cause});
  }

  const {html, errors} = await mjml2html(source, {filePath: path});
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

function getSubjectTemplate(name: TemplateName): TemplateDelegate {
  const cached = subjectTemplates.get(name);
  if (cached) return cached;

  const template = handlebars.compile(subjects[name], {noEscape: true});
  subjectTemplates.set(name, template);
  return template;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export async function renderEmail<Name extends TemplateName>(
  name: Name,
  data: TemplateVariables[Name],
): Promise<RenderedEmail> {
  const htmlTemplate = await getHtmlTemplate(name);
  const subjectTemplate = getSubjectTemplate(name);

  return {
    subject: subjectTemplate(data),
    html: htmlTemplate(data),
    text: renderText(name, data),
  };
}
