export const ONBOARDING_URL_RE = /\/setup\/workspaces\/new\/?$/u;
export const WORKSPACE_INTEGRATIONS_URL_RE = /\/workspaces\/[^/]+\/integrations\/?$/u;
export const SETUP_NAVIGATION_TIMEOUT_MS = 15_000;

export function workspaceUrlRe(workspaceId: string): RegExp {
  return new RegExp(`/workspaces/${workspaceId}(/|$)`, 'u');
}
