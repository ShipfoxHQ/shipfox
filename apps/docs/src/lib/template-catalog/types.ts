export type TemplateIcon =
  | 'github'
  | 'linear'
  | 'jira'
  | 'clickup'
  | 'discord'
  | 'slack'
  | 'discord'
  | 'sentry'
  | 'notion'
  | 'posthog'
  | 'shipfox';

export const templateIconLabels: Record<TemplateIcon, string> = {
  github: 'GitHub',
  linear: 'Linear',
  jira: 'Jira',
  clickup: 'ClickUp',
  discord: 'Discord',
  slack: 'Slack',
  discord: 'Discord',
  sentry: 'Sentry',
  notion: 'Notion',
  posthog: 'PostHog',
  shipfox: 'Shipfox',
};

export type TemplateFlowKind = 'trigger' | 'agent' | 'check' | 'tool' | 'write' | 'human';

export interface TemplateFlowStep {
  kind: TemplateFlowKind;
  provider?: TemplateIcon;
  title: string;
  detail: string;
  /** Index of an earlier step this one sends work back to. */
  loopsTo?: number;
}

export interface TemplateWrite {
  /** Absent when the provider depends on the reader's choices, such as the tracker. */
  provider?: TemplateIcon;
  action: string;
}

export interface TemplateRole {
  role: string;
  providers: TemplateIcon[];
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
  keywords: string[];
  starts: string;
  flow: TemplateFlowStep[];
  writes: TemplateWrite[];
  roles: TemplateRole[];
  href: string;
}

export interface TemplateVariant {
  bindings: Record<string, string>;
  yaml: string;
}

export interface TemplateDetail extends TemplateCatalogEntry {
  prerequisites: string[];
  options: TemplateOption[];
  models: {key: string; note?: string; model?: string; thinking?: string}[];
  variants: TemplateVariant[];
  related: TemplateCatalogEntry[];
}

export function templateIntegrations(entry: TemplateCatalogEntry): TemplateIcon[] {
  return [...new Set(entry.roles.flatMap((role) => role.providers))];
}

export interface TemplateOption {
  id: string;
  question?: string;
  choices: {id: string; label?: string; default?: boolean; tradeoff?: string}[];
}

export interface TemplateCatalogDocument {
  id: string;
  templates: TemplateDetail[];
}
