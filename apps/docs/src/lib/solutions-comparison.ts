import type {CatalogProvider} from './integration-catalog';
import {tableValue} from './markdown';

type ComparisonCell = string | {label: string; href: string}[];

type ComparisonRow = {
  pain: string;
  local: ComparisonCell;
  provider: ComparisonCell;
  ci: ComparisonCell;
  shipfox: ComparisonCell;
};

export const comparisonColumns = [
  {key: 'local', label: 'Local coding agent'},
  {key: 'provider', label: 'Agent automations'},
  {key: 'ci', label: 'CI platform'},
  {key: 'shipfox', label: 'Software factory (Shipfox)'},
] as const;

export function getComparisonSections(
  providers: readonly CatalogProvider[],
): Record<string, {title: string; rows: ComparisonRow[]}> {
  const eventProviders = providers.filter((provider) => provider.eventCount > 0);
  const toolProviders = providers.filter((provider) => provider.toolCount > 0);
  const eventCount = eventProviders.reduce((total, provider) => total + provider.eventCount, 0);
  const toolCount = toolProviders.reduce((total, provider) => total + provider.toolCount, 0);

  return {
    examples: {
      title: 'Example providers',
      rows: [
        {
          pain: 'Products',
          local: [
            {label: 'Claude Code', href: 'https://code.claude.com/docs/en/overview'},
            {label: 'Codex CLI', href: 'https://developers.openai.com/codex/cli/'},
            {label: 'OpenCode', href: 'https://opencode.ai/'},
          ],
          provider: [
            {
              label: 'GitHub Agentic Workflows',
              href: 'https://docs.github.com/en/copilot/concepts/agents/about-github-agentic-workflows',
            },
            {label: 'Claude Code Routines', href: 'https://code.claude.com/docs/en/routines'},
            {label: 'Cursor Automations', href: 'https://cursor.com/docs/cloud-agent/automations'},
          ],
          ci: [
            {
              label: 'GitHub Actions',
              href: 'https://docs.github.com/en/actions/get-started/understand-github-actions',
            },
            {label: 'GitLab CI/CD', href: 'https://docs.gitlab.com/ci/pipelines/'},
          ],
          shipfox: [{label: 'Shipfox', href: '/editions'}],
        },
      ],
    },
    execution: {
      title: 'Running work',
      rows: [
        {
          pain: 'Where code runs',
          local: "Engineer's machine",
          provider: 'Provider-managed cloud runner',
          ci: 'Hosted or self-hosted runners',
          shipfox: [
            {
              label: 'Hosted or self-managed runners',
              href: '/understand/runners-and-execution-environments',
            },
          ],
        },
        {
          pain: 'Execution environment',
          local: 'No runner choice',
          provider: 'Preset runner environment',
          ci: 'Custom runners, images, and network',
          shipfox: [
            {
              label: 'Cloud runners in a range of sizes',
              href: '/reference/runner-labels',
            },
            {
              label: 'Self-hosted runners on your infrastructure',
              href: '/understand/runners-and-execution-environments',
            },
          ],
        },
        {
          pain: 'Parallel work',
          local: 'No managed parallel jobs',
          provider: 'Parallel managed runs',
          ci: 'Parallel jobs within runner capacity',
          shipfox: 'Parallel jobs by default',
        },
        {
          pain: 'Triggers',
          local: 'Human starts a session',
          provider: 'Provider-supported events and schedules',
          ci: 'Repository events, schedules, and webhooks',
          shipfox: [
            {
              label: `${eventProviders.length} built-in event sources, ${eventCount} event types`,
              href: '/integrations',
            },
            {label: 'Cron schedules', href: '/how-to/author-workflows/schedule-workflows'},
            {label: 'Manual triggers', href: '/how-to/author-workflows/run-manually'},
          ],
        },
      ],
    },
    orchestration: {
      title: 'Coordinating agents and steps',
      rows: [
        {
          pain: 'Later review comments',
          local: 'Engineer follows up in chat',
          provider: 'New automation run',
          ci: 'New workflow run',
          shipfox: [
            {label: 'Listening job continues the same run', href: '/understand/listening-jobs'},
          ],
        },
        {
          pain: 'Failed check needs a code fix',
          local: 'Engineer prompts another attempt',
          provider: 'No independent feedback gate',
          ci: 'Checks fail jobs; no built-in agent repair',
          shipfox: [
            {label: 'Gate restarts agent with check feedback', href: '/understand/feedback-loops'},
          ],
        },
        {
          pain: 'Agent and fixed steps in one flow',
          local: 'No workflow orchestration',
          provider: 'No built-in mixed-step workflow',
          ci: 'Agent call needs job scripting',
          shipfox: [{label: 'Agent, run, and tool steps', href: '/understand/jobs-and-steps'}],
        },
        {
          pain: 'Agent conversation across steps',
          local: 'No shared workflow session',
          provider: 'No cross-run agent session',
          ci: 'No native agent session across jobs',
          shipfox: [
            {label: 'Named session across steps and jobs', href: '/understand/agent-sessions'},
          ],
        },
      ],
    },
    control: {
      title: 'Team control',
      rows: [
        {
          pain: 'Shared team process',
          local: 'No shared run process',
          provider: 'Reusable saved automations',
          ci: 'Shared jobs and workflows',
          shipfox: 'Shared workflow definitions',
        },
        {
          pain: 'Configuration in code',
          local: 'No versioned workflow definition',
          provider: 'Usually configured in provider UI',
          ci: 'Workflow files in the repo',
          shipfox: 'Workflow YAML in the repo',
        },
        {
          pain: 'Model choice',
          local: "Agent's supported models",
          provider: 'Provider-supported models',
          ci: 'Chosen in the agent call',
          shipfox: [{label: 'Broad selection of managed models', href: '/reference/cloud-models'}],
        },
        {
          pain: 'Agent-ready external tools',
          local: 'Engineer adds MCP servers',
          provider: 'Small native action set; MCP for more',
          ci: 'Agent tools need custom wiring',
          shipfox: [
            {
              label: `${toolProviders.length} tool integrations, ${toolCount} tools`,
              href: '/integrations',
            },
          ],
        },
        {
          pain: 'Tool credentials and scope',
          local: 'Personal credentials',
          provider: 'MCP often uses personal OAuth and grants all server tools',
          ci: 'Secrets passed to jobs',
          shipfox: [
            {
              label: 'Workspace credentials; selected tools per step',
              href: '/understand/integrations-connections-and-tools',
            },
          ],
        },
      ],
    },
    visibility: {
      title: 'Visibility and cost',
      rows: [
        {
          pain: 'Activity logs',
          local: 'No shared run history',
          provider: 'Automation session logs',
          ci: 'Workflow and job logs',
          shipfox: [
            {label: 'Run, step, and agent logs', href: '/how-to/run-and-troubleshoot/inspect-logs'},
          ],
        },
        {
          pain: 'Model cost by task',
          local: 'No shared cost per task',
          provider: 'Usage in provider account',
          ci: 'Model cost separate from runner usage',
          shipfox: [
            {
              label: 'Agent usage and cost per step',
              href: '/how-to/run-and-troubleshoot/inspect-logs',
            },
          ],
        },
      ],
    },
  };
}

function serializeComparisonCell(cell: ComparisonCell): string {
  return typeof cell === 'string'
    ? tableValue(cell)
    : cell.map(({label, href}) => `[${tableValue(label)}](${href})`).join(', ');
}

export function serializeSolutionsComparison(providers: readonly CatalogProvider[]): string {
  return [
    '| Comparison point | Local coding agent | Agent automations | CI platform | Software factory (Shipfox) |',
    '| --- | --- | --- | --- | --- |',
    ...Object.values(getComparisonSections(providers)).flatMap(({title, rows}) => [
      `| **${tableValue(title)}** | | | | |`,
      ...rows.map(
        (row) =>
          `| ${tableValue(row.pain)} | ${serializeComparisonCell(row.local)} | ${serializeComparisonCell(row.provider)} | ${serializeComparisonCell(row.ci)} | ${serializeComparisonCell(row.shipfox)} |`,
      ),
    ]),
  ].join('\n');
}
