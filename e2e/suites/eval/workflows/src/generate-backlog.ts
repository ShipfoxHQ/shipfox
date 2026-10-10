import {writeFile} from 'node:fs/promises';
import {toolGrants} from '@shipfox/actions/tool-grants';
import {type CatalogUnit, uncoveredUnits} from './contract-coverage.js';
import {loadContracts} from './contracts.js';

// One-time: lists the units that nothing covers yet, each with the Linear issue of the unit
// that adds its case. Later units remove their entries by hand and lower `ceiling`.
// A pattern is `provider.tool#method`, `provider.tool`, or `provider:kind`. The first match wins.
const COVERING_ISSUES: ReadonlyArray<{issue: string; patterns: readonly string[]}> = [
  {
    issue: 'ENG-2798',
    patterns: [
      'github.issue_read#get',
      'github.list_issue_types',
      'github.list_issues',
      'github.search_issues',
      'github.pull_request_read#get',
      'github.list_pull_requests',
      'github.search_pull_requests',
      'github.actions_list#list_workflows',
      'github.actions_get#get_workflow',
      'github.actions_list#list_workflow_runs',
      'linear.list_teams',
      'linear.get_team',
      'linear.list_users',
      'linear.get_user',
      'linear.list_issue_statuses',
      'linear.get_issue_status',
      'linear.list_issues',
      'linear.get_issue',
      'linear.list_comments',
      'linear.list_projects',
      'linear.get_project',
      'linear.search_documentation',
    ],
  },
  {
    issue: 'ENG-2800',
    patterns: [
      'slack.read_channel_info',
      'slack.read_channel',
      'slack.read_thread',
      'slack.read_user_profile',
      'slack.read_channel_members',
      'slack.search_channels',
      'clickup.search_tasks',
      'clickup.get_task',
      'clickup.get_task_comments',
      'notion.search',
      'notion.get_page',
      'notion.get_page_content',
      'notion.get_comments',
      'posthog.execute-sql',
      'posthog.feature-flag-get-all',
    ],
  },
  {issue: 'ENG-2808', patterns: ['jira:read']},
  {issue: 'ENG-2809', patterns: ['sentry:read']},
  {issue: 'ENG-2810', patterns: ['discord:read']},
  {issue: 'ENG-2811', patterns: ['github.issue_read', 'github.pull_request_read']},
  {
    issue: 'ENG-2818',
    patterns: ['github.actions_list', 'github.actions_get', 'github.get_job_logs'],
  },
  {
    issue: 'ENG-2812',
    patterns: [
      'linear.get_document',
      'linear.list_documents',
      'linear.list_cycles',
      'linear.get_milestone',
      'linear.list_milestones',
      'linear.list_issue_labels',
      'linear.list_project_labels',
    ],
  },
  {issue: 'ENG-2820', patterns: ['linear:read']},
  {issue: 'ENG-2813', patterns: ['posthog:read']},
  {issue: 'ENG-2822', patterns: ['slack.get_permalink', 'notion.query_data_source']},
  {issue: 'ENG-2814', patterns: ['slack:write']},
  {issue: 'ENG-2815', patterns: ['clickup:write', 'notion:write']},
  {issue: 'ENG-2826', patterns: ['jira:write']},
  {issue: 'ENG-2827', patterns: ['discord:write']},
  {
    issue: 'ENG-2828',
    patterns: [
      'github.issue_write',
      'github.sub_issue_write',
      'github.add_issue_comment',
      'github.create_branch',
      'github.create_commit',
      'github.create_blob',
      'github.delete_branch',
      'github.check_run_write',
    ],
  },
  {issue: 'ENG-2829', patterns: ['github.actions_run_trigger']},
  {issue: 'ENG-2834', patterns: ['github:write']},
  {
    issue: 'ENG-2816',
    patterns: [
      'linear.save_issue',
      'linear.save_comment',
      'linear.delete_comment',
      'linear.create_issue_label',
      'linear.create_attachment',
      'linear.prepare_attachment_upload',
      'linear.create_attachment_from_upload',
      'linear.delete_attachment',
    ],
  },
  {issue: 'ENG-2830', patterns: ['linear:write']},
];

function matches({pattern, unit}: {pattern: string; unit: CatalogUnit}): boolean {
  if (pattern.includes(':')) return pattern === `${unit.provider}:${unit.kind}`;
  return pattern === unit.key || pattern === `${unit.provider}.${unit.tool}`;
}

function coveringIssue(unit: CatalogUnit): string {
  const found = COVERING_ISSUES.find(({patterns}) =>
    patterns.some((pattern) => matches({pattern, unit})),
  );
  if (found === undefined) throw new Error(`No unit covers ${unit.key}`);
  return found.issue;
}

const backlogPath = new URL('../cases/contracts/backlog.yaml', import.meta.url);
const units = uncoveredUnits({grants: toolGrants, files: await loadContracts()});
const entries = units.map((unit) => {
  const method = unit.method === undefined ? '' : `, method: ${unit.method}`;
  return `  - {tool: ${unit.provider}.${unit.tool}${method}, kind: ${unit.kind}, issue: ${coveringIssue(unit)}}`;
});
await writeFile(backlogPath, [`ceiling: ${entries.length}`, 'entries:', ...entries, ''].join('\n'));
process.stdout.write(`Wrote ${entries.length} backlog entries\n`);
