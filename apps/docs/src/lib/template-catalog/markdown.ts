import {renderAgentHandoff} from '../agent-handoff';
import type {MarkdownAudience} from '../machine-readable';
import {inlineCode} from '../markdown';
import {buildTemplatePagePrompt} from './prompt';
import {
  type TemplateCatalogEntry,
  type TemplateDetail,
  type TemplateWrite,
  templateIconLabels,
  templateIntegrations,
} from './types';

const CREATE_WORKFLOW_SKILL = 'create-workflow-from-template';

export function serializeTemplateCatalog(templates: readonly TemplateCatalogEntry[]): string {
  return templates
    .map(
      (template) =>
        `- [${template.title}](${template.href}): ${template.summary} Starts when: ${template.starts}. Integrations: ${integrationNames(template)}.`,
    )
    .join('\n');
}

export function serializeTemplateDetail({
  template,
  audience,
}: {
  template: TemplateDetail;
  audience: MarkdownAudience;
}): string {
  const variant = template.variants.at(-1);
  const sections = [
    `Starts when: ${template.starts}. Integrations: ${integrationNames(template)}.`,
    '## How it works',
    template.flow
      .map((step, index) => {
        const loop =
          step.loopsTo === undefined
            ? ''
            : ` If this step fails, the workflow goes back to step ${step.loopsTo + 1}.`;
        return `${index + 1}. **${step.title}.** ${step.detail}${loop}`;
      })
      .join('\n'),
    '## What it writes',
    template.writes.map(serializeWrite).join('\n'),
  ];

  if (template.prerequisites.length > 0) {
    sections.push(
      '## Before you start',
      template.prerequisites.map((item) => `- ${item}`).join('\n'),
    );
  }

  if (template.options.length > 0) {
    sections.push(
      '## Choices you make',
      'When you set up this workflow, your coding agent asks you these questions. The workflow file on this page uses the default answers.',
      ...template.options.map((option) => {
        const fallback = option.choices.find((choice) => choice.default) ?? option.choices[0];
        const choices = option.choices.map((choice) => {
          const marker = choice.id === fallback?.id ? ' (default)' : '';
          const tradeoff = choice.tradeoff ? `: ${choice.tradeoff}` : '';
          return `- **${choice.label ?? choice.id}**${marker}${tradeoff}`;
        });
        return [`### ${option.question ?? option.id}`, '', ...choices].join('\n');
      }),
    );
  }

  if (template.models.length > 0) {
    sections.push(
      '## Models',
      'When you set up this workflow, your coding agent suggests models that your workspace can use. You choose the model for each step.',
      template.models
        .map((model) => {
          const tested = model.model
            ? ` Tested with ${inlineCode(model.model)}${model.thinking ? ` at ${model.thinking} thinking` : ''}.`
            : '';
          return `- ${inlineCode(model.key)}: ${model.note ?? ''}${tested}`;
        })
        .join('\n'),
    );
  }

  const prompt = buildTemplatePagePrompt(template.id, template.roles, variant?.bindings ?? {});
  sections.push(
    '## Set up this workflow',
    ...(audience === 'human'
      ? [
          'Open your coding agent in your repository and paste this prompt. The agent needs the [Shipfox MCP server](/how-to/set-up-work/connect-mcp-client).',
          ['```text', prompt, '```'].join('\n'),
        ]
      : [renderAgentHandoff({skill: CREATE_WORKFLOW_SKILL, prompt, audience})]),
    `The workflow file, \`.shipfox/workflows/${template.id}.yml\`, with every default:`,
    ['```yaml', (variant?.yaml ?? '').trimEnd(), '```'].join('\n'),
  );

  if (template.related.length > 0) {
    sections.push(
      '## Related examples',
      template.related.map((related) => `- [${related.title}](${related.href})`).join('\n'),
    );
  }

  return sections.join('\n\n');
}

function serializeWrite(write: TemplateWrite): string {
  return write.provider === undefined
    ? `- ${write.action}`
    : `- ${templateIconLabels[write.provider]}: ${write.action}`;
}

function integrationNames(template: TemplateCatalogEntry): string {
  return templateIntegrations(template)
    .map((icon) => templateIconLabels[icon])
    .join(', ');
}
