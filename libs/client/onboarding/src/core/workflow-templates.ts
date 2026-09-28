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
  prompt: string;
}

export interface WorkflowTemplateSuggestions {
  /** The first template to try, shown in full. */
  recommended: WorkflowTemplate | undefined;
  /** The next usable templates, one line each. */
  others: readonly WorkflowTemplate[];
}

export const MAX_OTHER_SUGGESTED_TEMPLATES = 3;

/**
 * Picks the panel's suggestions from templates the workspace can use now.
 * Templates that need a connection are left out, and the list is capped, so
 * the panel stays the same size however much of the catalog matches. The
 * server already orders "Try it now" ahead of "Starts on an event", so the
 * recommended template is one the user can run today.
 */
export function suggestWorkflowTemplates(
  templates: readonly WorkflowTemplate[],
): WorkflowTemplateSuggestions {
  const [recommended, ...others] = templates.filter(
    (template) => template.group !== 'needs_connection',
  );
  return {recommended, others: others.slice(0, MAX_OTHER_SUGGESTED_TEMPLATES)};
}

const TRY_NOW_LABEL = 'Try it now';
const STARTS_ON_EVENT_FALLBACK_LABEL = 'Starts on an event';

/** How a usable template starts, shown next to its title. */
export function workflowTemplateLabel(template: WorkflowTemplate): string {
  if (template.group === 'try_now') return TRY_NOW_LABEL;
  return template.startLabel ?? STARTS_ON_EVENT_FALLBACK_LABEL;
}
