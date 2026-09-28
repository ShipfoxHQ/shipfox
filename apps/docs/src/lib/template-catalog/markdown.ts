import {inlineCode} from '../markdown';
import {buildTemplatePagePrompt} from './prompt';
import {
  TEMPLATE_GROUPS,
  type TemplateCatalogEntry,
  type TemplateDetail,
  templateGroupLabels,
  templateIconLabels,
  templateIntegrations,
} from './types';

export function serializeTemplateCatalog(templates: readonly TemplateCatalogEntry[]): string {
  return TEMPLATE_GROUPS.flatMap((group) => {
    const inGroup = templates.filter((template) => template.group === group);
    if (inGroup.length === 0) return [];
    return [
      `## ${templateGroupLabels[group]}`,
      '',
      ...inGroup.map(
        (template) =>
          `- [${template.title}](${template.href}): ${template.summary} Starts when: ${template.starts}. Integrations: ${integrationNames(template)}.`,
      ),
      '',
    ];
  })
    .join('\n')
    .trim();
}

export function serializeTemplateDetail(template: TemplateDetail): string {
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
    template.writes
      .map((write) => `- ${templateIconLabels[write.icon]}: ${write.action}.`)
      .join('\n'),
    '## Before you start',
    template.prerequisites.map((item) => `- ${item}`).join('\n'),
  ];

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

  sections.push(
    '## Set up this workflow',
    'Open your coding agent in your repository and paste this prompt. The agent needs the [Shipfox MCP server](/how-to/set-up-work/connect-mcp-client).',
    [
      '```text',
      buildTemplatePagePrompt(template.id, template.roles, variant?.bindings ?? {}),
      '```',
    ].join('\n'),
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

function integrationNames(template: TemplateCatalogEntry): string {
  return templateIntegrations(template)
    .map((icon) => templateIconLabels[icon])
    .join(', ');
}
