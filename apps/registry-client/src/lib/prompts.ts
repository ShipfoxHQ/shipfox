import {buildTemplatePrompt} from '@shipfox/workflow-templates/prompt';
import {providerLabel} from './providers';

export interface PromptRole {
  id: string;
  providers: string[];
  optional: boolean;
  from?: 'project';
}

// First-party templates keep their bare id, the name the create-workflow-from-template skill
// already knows. Mirrors buildUpgradePrompt in @shipfox/workflow-templates.
const FIRST_PARTY_PREFIX = 'shipfox/';

/** The prompt a reader pastes into a coding agent, naming the provider choices made on the page. */
export function buildAdoptPrompt({
  packageName,
  roles,
  bindings,
}: {
  packageName: string;
  roles: readonly PromptRole[];
  bindings: Readonly<Record<string, string | undefined>>;
}): string {
  const templateId = packageName.startsWith(FIRST_PARTY_PREFIX)
    ? packageName.slice(FIRST_PARTY_PREFIX.length)
    : packageName;
  const choices = roles.filter(isChoosable).map((role) => {
    const provider = bindings[role.id];
    if (provider === undefined) return `without the ${role.id} part`;
    return `with ${providerLabel(provider)} as the ${role.id}`;
  });
  return buildTemplatePrompt({templateId, choices});
}

/** A role the reader picks on the page: optional, or with more than one provider. */
export function isChoosable(role: PromptRole): boolean {
  return role.from !== 'project' && (role.optional || role.providers.length > 1);
}
