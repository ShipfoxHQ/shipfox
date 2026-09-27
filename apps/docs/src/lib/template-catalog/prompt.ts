import {type TemplateRole, templateIconLabels} from './types';

/** The prompt a user pastes into a coding agent; the create-workflow-from-template skill confirms each choice it names. */
export function buildTemplatePrompt(
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
  const suffix = choices.length > 0 ? `, with ${choices.join(' and ')}` : '';
  return `Use Shipfox to create a workflow from the ${templateId} template${suffix}.`;
}
