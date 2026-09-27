import type {WorkflowTemplateOption} from '@shipfox/workflow-templates';

export type TemplateIcon =
  | 'github'
  | 'linear'
  | 'jira'
  | 'clickup'
  | 'slack'
  | 'sentry'
  | 'notion'
  | 'posthog'
  | 'shipfox';

// Placeholder groups from the Software factory starter catalog project.
export type TemplateGroup = 'bring-in' | 'deliver' | 'improve' | 'operate';

export const templateGroupLabels: Record<TemplateGroup, string> = {
  'bring-in': 'Bring work in',
  deliver: 'Deliver changes',
  improve: 'Improve engineering',
  operate: 'Operate the factory',
};

export const TEMPLATE_GROUPS = Object.keys(templateGroupLabels) as TemplateGroup[];

export const templateIconLabels: Record<TemplateIcon, string> = {
  github: 'GitHub',
  linear: 'Linear',
  jira: 'Jira',
  clickup: 'ClickUp',
  slack: 'Slack',
  sentry: 'Sentry',
  notion: 'Notion',
  posthog: 'PostHog',
  shipfox: 'Shipfox',
};

export type TemplateFlowKind = 'trigger' | 'agent' | 'check' | 'tool' | 'write' | 'human';

export interface TemplateFlowStep {
  kind: TemplateFlowKind;
  icon?: TemplateIcon;
  title: string;
  detail: string;
  /** Index of an earlier step this one sends work back to. */
  loopsTo?: number;
}

export interface TemplateRole {
  role: string;
  providers: TemplateIcon[];
  upcoming: TemplateIcon[];
  optional: boolean;
  fromProject: boolean;
  question?: string;
}

export interface TemplateCatalogEntry {
  id: string;
  title: string;
  summary: string;
  revision: number;
  addedAt: string;
  group: TemplateGroup;
  starts: string;
  flow: TemplateFlowStep[];
  writes: {icon: TemplateIcon; action: string}[];
  roles: TemplateRole[];
  href: string;
}

export interface TemplateVariant {
  bindings: Record<string, string>;
  yaml: string;
}

export interface TemplateDetail extends TemplateCatalogEntry {
  prerequisites: string[];
  options: WorkflowTemplateOption[];
  models: {key: string; note?: string; model?: string; thinking?: string}[];
  variants: TemplateVariant[];
  related: TemplateCatalogEntry[];
}

export function templateIntegrations(entry: TemplateCatalogEntry): TemplateIcon[] {
  return [...new Set(entry.roles.flatMap((role) => role.providers))];
}
