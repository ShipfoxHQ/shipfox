import {FIRST_PARTY_TEMPLATE_NAMESPACE} from './first-party.js';

export interface BuildTemplatePromptInput {
  templateId: string;
  /** Clauses naming the choices the user already made, such as `with Slack as the report`. */
  choices?: readonly string[];
}

/** The prompt a user pastes into a coding agent; the create-workflow-from-template skill confirms each choice it names. */
export function buildTemplatePrompt({templateId, choices = []}: BuildTemplatePromptInput): string {
  const suffix = choices.length > 0 ? `, ${choices.join(' and ')}` : '';
  return `Use Shipfox to create a workflow from the ${templateId} template${suffix}.`;
}

export interface BuildUpgradePromptInput {
  /** The registry package, such as `shipfox/ticket-to-pr`. A first-party template is named by its bare id. */
  package: string;
  /** Repository path of the adopted workflow, when the definition has one. */
  configPath?: string | null | undefined;
  /** The version to upgrade to. */
  version: string;
}

/** The prompt a user pastes into a coding agent to upgrade an adopted template; the upgrade-workflow skill takes it from there. */
export function buildUpgradePrompt({
  package: packageName,
  configPath,
  version,
}: BuildUpgradePromptInput): string {
  const firstPartyPrefix = `${FIRST_PARTY_TEMPLATE_NAMESPACE}/`;
  const template = packageName.startsWith(firstPartyPrefix)
    ? packageName.slice(firstPartyPrefix.length)
    : packageName;
  const location = configPath ? ` in \`${configPath}\`` : '';
  return `Use Shipfox to upgrade the ${template} workflow${location} to ${version}.`;
}
