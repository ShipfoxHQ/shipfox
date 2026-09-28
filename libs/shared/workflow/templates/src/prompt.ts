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
