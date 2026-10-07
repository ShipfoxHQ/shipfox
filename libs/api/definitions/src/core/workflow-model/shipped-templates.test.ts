import {parseWorkflowDocument} from '@shipfox/workflow-document';
import {
  applyTemplateOptions,
  composeTemplate,
  loadShippedTemplates,
  templateVariants,
  type WorkflowTemplate,
} from '@shipfox/workflow-templates';
import {parse as parseYaml} from 'yaml';
import {agentValidationCatalog} from '#test/agent-validation-catalog.js';
import {normalizeWorkflowDocument} from './normalize-workflow-document.js';

describe('shipped templates', () => {
  it.each(
    loadShippedTemplates().flatMap((template) =>
      templateVariants(template).map(({bindings, options}) => ({
        label: `${template.id} ${JSON.stringify(bindings)} ${JSON.stringify(options)}`,
        template,
        bindings,
        options,
      })),
    ),
  )('normalizes $label', ({template, bindings, options}) => {
    const yaml = fillSlots(
      applyTemplateOptions(composeTemplate(template, bindings), options),
      template,
    );

    expect(() =>
      normalizeWorkflowDocument(parseWorkflowDocument(parseYaml(yaml)), {
        defaultRunnerLabels: ['ubuntu-latest'],
        agentValidationCatalog,
      }),
    ).not.toThrow();
  });
});

function fillSlots(yaml: string, template: WorkflowTemplate): string {
  let filled = yaml;
  for (const {id} of template.manifest.slots) {
    filled = filled.replace(
      new RegExp(`^(\\s*)# slot:${id}\\s*$`, 'gm'),
      '$1- run: echo slot-placeholder',
    );
    filled = filled.replaceAll(new RegExp(`# slot:${id}(?![a-z0-9_-])`, 'g'), '');
  }
  return filled.replace(/replace-with-[a-z0-9_-]+/g, 'echo slot-placeholder');
}
