import {buildTemplatePrompt} from '@shipfox/workflow-templates/prompt';
import {type TemplateRole, templateIconLabels} from './types';

/** Names the provider choices on the page, so the create-workflow-from-template skill confirms them. */
export function buildTemplatePagePrompt(
  templateId: string,
  roles: TemplateRole[],
  bindings: Record<string, string | undefined>,
): string {
  const choices = roles
    .filter((role) => !role.fromProject && (role.optional || role.providers.length > 1))
    .map((role) => {
      const provider = bindings[role.role];
      if (provider === undefined) return `without the ${role.role} part`;
      return `${templateIconLabels[provider as keyof typeof templateIconLabels]} as the ${role.role}`;
    });
  return buildTemplatePrompt({templateId, choices});
}
