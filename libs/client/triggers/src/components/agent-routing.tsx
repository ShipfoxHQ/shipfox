import {useProjectsInfiniteQuery} from '@shipfox/client-projects';
import {Icon} from '@shipfox/react-ui/icon';
import {Panel, PanelBody, PanelHeader, PanelTitle} from '@shipfox/react-ui/panel';
import {Text} from '@shipfox/react-ui/typography';
import {useMemo} from 'react';
import type {
  TriggerEventAgentDecision,
  TriggerEventAgentDecisionOutcome,
} from '#core/trigger-event.js';

const SHIPPY_AGENT_KEY = 'shippy';

const decisionOrder: Record<TriggerEventAgentDecisionOutcome, number> = {
  owner: 0,
  default: 0,
  ambiguous: 1,
  'filter-error': 2,
  dropped: 3,
};

export function AgentRouting({
  workspaceId,
  decisions,
}: {
  workspaceId?: string | undefined;
  decisions: readonly TriggerEventAgentDecision[];
}) {
  if (decisions.length === 0) return null;
  if (!workspaceId) return <AgentRoutingList decisions={decisions} projectNames={new Map()} />;
  return <AgentRoutingWithProjects workspaceId={workspaceId} decisions={decisions} />;
}

function AgentRoutingWithProjects({
  workspaceId,
  decisions,
}: {
  workspaceId: string;
  decisions: readonly TriggerEventAgentDecision[];
}) {
  const projectsQuery = useProjectsInfiniteQuery(workspaceId);
  const projectNames = useMemo(
    () =>
      new Map(
        projectsQuery.data?.pages
          .flatMap((page) => page.projects)
          .map((project) => [project.id, project.name] as const),
      ),
    [projectsQuery.data],
  );
  return <AgentRoutingList decisions={decisions} projectNames={projectNames} />;
}

function AgentRoutingList({
  decisions,
  projectNames,
}: {
  decisions: readonly TriggerEventAgentDecision[];
  projectNames: ReadonlyMap<string, string>;
}) {
  const sorted = [...decisions].sort(
    (left, right) => decisionOrder[left.decision] - decisionOrder[right.decision],
  );
  const winner = sorted.find(
    (decision) => decision.decision === 'owner' || decision.decision === 'default',
  );

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Agent routing</PanelTitle>
      </PanelHeader>
      <PanelBody>
        <ul>
          {sorted.map((decision) => {
            const status = agentDecisionStatus(decision, winner);
            const projectName = decision.projectId ? projectNames.get(decision.projectId) : null;
            return (
              <li
                key={decision.id}
                className="border-b border-border-neutral-base px-row py-row last:border-b-0"
              >
                <div className="flex min-w-0 items-start gap-inline">
                  <Icon
                    name="cornerDownRightLine"
                    className="size-14 shrink-0 text-foreground-neutral-disabled"
                    aria-hidden="true"
                  />
                  <div className="flex min-w-0 flex-col gap-tight">
                    <Text size="sm" className="min-w-0 truncate text-foreground-neutral-base">
                      {decision.agentKey === null ? 'No agent' : agentName(decision.agentKey)}
                      {projectName ? (
                        <span className="text-foreground-neutral-muted"> · {projectName}</span>
                      ) : null}
                    </Text>
                    <Text size="xs" className={status.className}>
                      {status.label}
                    </Text>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </PanelBody>
    </Panel>
  );
}

function agentName(agentKey: string): string {
  return agentKey === SHIPPY_AGENT_KEY ? 'Shippy' : agentKey;
}

function agentDecisionStatus(
  decision: TriggerEventAgentDecision,
  winner: TriggerEventAgentDecision | undefined,
): {label: string; className: string} {
  const muted = 'text-foreground-neutral-muted';
  switch (decision.decision) {
    case 'owner':
      return {
        label: decision.fromRule
          ? 'Answered because its rule matched'
          : 'Answered because it owns this conversation',
        className: muted,
      };
    case 'default':
      return {label: 'Answered as the default agent, because no rule matched', className: muted};
    case 'ambiguous': {
      const winnerName = winner?.agentKey ? agentName(winner.agentKey) : 'another agent';
      return {
        label: `Its rule also matched, but ${winnerName} answered. One agent answers each request: custom agents come before Shippy, then the rule added first.`,
        className: muted,
      };
    }
    case 'filter-error':
      return {
        label: 'Rule filter could not be evaluated',
        className: 'text-foreground-highlight-error',
      };
    case 'dropped':
      return {label: droppedLabel(decision.reason), className: 'text-foreground-neutral-disabled'};
  }
}

function droppedLabel(reason: string | null): string {
  switch (reason) {
    case 'no-owner':
      return 'Dropped, because no agent owns this conversation. Only a new request starts one.';
    case 'no-project':
      return 'Dropped, because the workspace has no project to answer it.';
    case 'project-access':
      return 'Dropped, because the project cannot use this connection.';
    case 'project-deleted':
      return 'Dropped, because the project was deleted.';
    default:
      return 'Dropped';
  }
}
