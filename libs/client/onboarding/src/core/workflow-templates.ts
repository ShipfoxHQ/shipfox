export type WorkflowTemplateGroup = 'try_now' | 'starts_on_event' | 'needs_connection';

/** A template as ranked for one workspace: the server owns grouping and order. */
export interface WorkflowTemplate {
  id: string;
  title: string;
  summary: string;
  group: WorkflowTemplateGroup;
  /** How an event-started template begins, such as "Starts on a failing dependency update". */
  startLabel: string | null;
  /** Provider keys, required ones first. */
  providers: readonly string[];
  missingProviders: readonly string[];
  prompt: string;
}

export interface WorkflowTemplateSuggestions {
  /** Templates the workspace can use now, in server rank order. */
  cards: readonly WorkflowTemplate[];
  /** Templates that need a connection first, one line each. */
  needsConnection: readonly WorkflowTemplate[];
}

export const MAX_SUGGESTED_TEMPLATE_CARDS = 4;

/**
 * Splits the ranked list into the panel's cards and its "Needs a connection"
 * lines. The server already orders "Try it now" ahead of "Starts on an event",
 * so the first cards are the ones the user can run today.
 */
export function suggestWorkflowTemplates(
  templates: readonly WorkflowTemplate[],
): WorkflowTemplateSuggestions {
  return {
    cards: templates
      .filter((template) => template.group !== 'needs_connection')
      .slice(0, MAX_SUGGESTED_TEMPLATE_CARDS),
    needsConnection: templates.filter((template) => template.group === 'needs_connection'),
  };
}

const TRY_NOW_LABEL = 'Try it now';
const STARTS_ON_EVENT_FALLBACK_LABEL = 'Starts on an event';

/** The card label for a usable template. */
export function workflowTemplateCardLabel(template: WorkflowTemplate): string {
  if (template.group === 'try_now') return TRY_NOW_LABEL;
  return template.startLabel ?? STARTS_ON_EVENT_FALLBACK_LABEL;
}

/** Joins names as "Slack", "Slack and Linear", or "Slack, Linear, and Jira". */
export function joinProviderNames(names: readonly string[]): string {
  if (names.length <= 2) return names.join(' and ');
  return `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}`;
}
