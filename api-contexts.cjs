const apiContextImplementationPaths = {
  agent: ['libs/api/agent'],
  annotations: ['libs/api/annotations'],
  auth: ['libs/api/auth'],
  definitions: ['libs/api/definitions'],
  integrations: [
    'libs/api/integration/core',
    'libs/api/integration/gitea',
    'libs/api/integration/github',
    'libs/api/integration/jira',
    'libs/api/integration/linear',
    'libs/api/integration/sentry',
    'libs/api/integration/slack',
    'libs/api/integration/webhook',
  ],
  logs: ['libs/api/logs'],
  projects: ['libs/api/projects'],
  runners: ['libs/api/runners'],
  secrets: ['libs/api/secrets'],
  triggers: ['libs/api/triggers'],
  workflows: ['libs/api/workflows'],
  workspaces: ['libs/api/workspaces'],
};

const apiContextExemptPaths = {
  'shared-infrastructure': [
    'libs/api/auth-context',
    'libs/api/dispatcher',
    'libs/api/email-challenges',
  ],
  'composition-root': ['libs/api/server'],
};

module.exports = {apiContextExemptPaths, apiContextImplementationPaths};
