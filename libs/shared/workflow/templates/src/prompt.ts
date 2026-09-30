export interface BuildTemplatePromptInput {
  templateId: string;
  /** Clauses naming the choices the user already made, such as `with Slack as the report`. */
  choices?: readonly string[];
}

/** The prompt the first-workflow panel shows for a user who has not picked a template yet. */
export const FIRST_WORKFLOW_PROMPT =
  "Set up a Shipfox workflow for this repository: read the Shipfox MCP server's `create-workflow-from-template` skill and follow it.";

/** The prompt a user pastes into a coding agent; the create-workflow-from-template skill confirms each choice it names. */
export function buildTemplatePrompt({templateId, choices = []}: BuildTemplatePromptInput): string {
  const suffix = choices.length > 0 ? `, ${choices.join(' and ')}` : '';
  return `Use Shipfox to create a workflow from the ${templateId} template${suffix}.`;
}

// Stays free of imports: the docs build runs this file directly under Node. Mirrors
// FIRST_PARTY_TEMPLATE_NAMESPACE in loader.ts.
const FIRST_PARTY_PREFIX = 'shipfox/';

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
  const template = packageName.startsWith(FIRST_PARTY_PREFIX)
    ? packageName.slice(FIRST_PARTY_PREFIX.length)
    : packageName;
  const location = configPath ? ` in \`${configPath}\`` : '';
  return `Use Shipfox to upgrade the ${template} workflow${location} to ${version}.`;
}
