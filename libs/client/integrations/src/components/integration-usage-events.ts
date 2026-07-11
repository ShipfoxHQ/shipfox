import type {IntegrationConnectionDto, SentryIssueAction} from '@shipfox/api-integration-core-dto';
import {SENTRY_ISSUE_ACTIONS} from '@shipfox/api-integration-core-dto';
import {linearWebhookEventNames} from '@shipfox/api-integration-linear-dto';
import {WEBHOOK_RECEIVED_EVENT} from '@shipfox/api-integration-webhook-dto';
import type {IntegrationUsageEvent} from './integration-usage-modal.js';

const GITHUB_EVENTS = [
  'push',
  'branch_protection_configuration',
  'branch_protection_rule',
  'check_run',
  'check_suite',
  'code_scanning_alert',
  'commit_comment',
  'create',
  'custom_property',
  'custom_property_values',
  'delete',
  'dependabot_alert',
  'deploy_key',
  'deployment',
  'deployment_protection_rule',
  'deployment_review',
  'deployment_status',
  'discussion',
  'discussion_comment',
  'fork',
  'github_app_authorization',
  'gollum',
  'installation',
  'installation_repositories',
  'installation_target',
  'issue_comment',
  'issue_dependencies',
  'issues',
  'label',
  'marketplace_purchase',
  'member',
  'membership',
  'merge_group',
  'meta',
  'milestone',
  'org_block',
  'organization',
  'package',
  'page_build',
  'personal_access_token_request',
  'ping',
  'project',
  'project_card',
  'project_column',
  'projects_v2',
  'projects_v2_item',
  'projects_v2_status_update',
  'public',
  'pull_request',
  'pull_request_review',
  'pull_request_review_comment',
  'pull_request_review_thread',
  'registry_package',
  'release',
  'repository',
  'repository_advisory',
  'repository_dispatch',
  'repository_import',
  'repository_ruleset',
  'repository_vulnerability_alert',
  'secret_scanning_alert',
  'secret_scanning_alert_location',
  'secret_scanning_scan',
  'security_advisory',
  'security_and_analysis',
  'sponsorship',
  'star',
  'status',
  'sub_issues',
  'team',
  'team_add',
  'watch',
  'workflow_dispatch',
  'workflow_job',
  'workflow_run',
] as const;

export function usageEventsForConnection(
  connection: IntegrationConnectionDto,
): IntegrationUsageEvent[] {
  if (connection.provider === 'webhook') {
    return [{value: WEBHOOK_RECEIVED_EVENT, label: WEBHOOK_RECEIVED_EVENT}];
  }

  if (connection.provider === 'github') {
    return GITHUB_EVENTS.map((event) => ({value: event, label: event}));
  }

  if (connection.provider === 'sentry') {
    return SENTRY_ISSUE_ACTIONS.map((action) => ({
      value: `issue.${action}`,
      label: sentryIssueEventLabel(action),
    }));
  }

  if (connection.provider === 'linear') {
    return linearWebhookEventNames.map((event) => ({value: event, label: event}));
  }

  if (connection.capabilities.includes('source_control')) {
    return [{value: 'push', label: 'push'}];
  }

  return [{value: 'received', label: 'received'}];
}

function sentryIssueEventLabel(action: SentryIssueAction): string {
  return `issue.${action}`;
}
