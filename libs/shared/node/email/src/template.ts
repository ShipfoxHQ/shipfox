import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createEmailRenderer} from './renderer.js';
import {builtInTemplates, type TemplateName, type TemplateVariables} from './text.js';

export type {RenderedEmail} from './renderer.js';

// The build compiles `emails/*.mjml` into `dist/emails/`. The path goes through the
// package root, so it resolves the same from `src/` (dev and tests) and from `dist/`.
const render = createEmailRenderer<TemplateVariables>({
  templatesDir: join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'emails'),
  templates: builtInTemplates,
});

export function renderEmail<Name extends TemplateName>(name: Name, data: TemplateVariables[Name]) {
  return render(name, data);
}
