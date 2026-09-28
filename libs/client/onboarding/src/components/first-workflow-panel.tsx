import {McpSetupInstructions} from '@shipfox/client-agent';
import {PROVIDER_CATALOG} from '@shipfox/client-integrations';
import {useClientAnalytics} from '@shipfox/client-shell/runtime';
import {Badge} from '@shipfox/react-ui/badge';
import {Button, ButtonLink} from '@shipfox/react-ui/button';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@shipfox/react-ui/collapsible';
import {useCopyToClipboard} from '@shipfox/react-ui/hooks';
import {Icon} from '@shipfox/react-ui/icon';
import {
  Panel,
  PanelBody,
  PanelCell,
  PanelGrid,
  PanelHeader,
  PanelTitle,
} from '@shipfox/react-ui/panel';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {toast} from '@shipfox/react-ui/toast';
import {Code, Text} from '@shipfox/react-ui/typography';
import {Link} from '@tanstack/react-router';
import {type ReactNode, useEffect, useId, useRef, useState} from 'react';
import type {FirstWorkflowProgress} from '#core/setup-checklist.js';
import {
  joinProviderNames,
  suggestWorkflowTemplates,
  type WorkflowTemplate,
  workflowTemplateCardLabel,
} from '#core/workflow-templates.js';
import {useWorkspaceAgentGrant, type WorkspaceAgentGrant} from '#hooks/api/agent-grants.js';
import {useWorkspaceWorkflowTemplatesQuery} from '#hooks/api/workflow-templates.js';
import type {WorkspaceReference} from './setup-checklist-types.js';

export const FIRST_WORKFLOW_PROMPT =
  "Set up a Shipfox workflow for this repository: read the Shipfox MCP server's `create-workflow-from-template` skill and follow it.";

const EXAMPLES_URL = 'https://www.shipfox.io/docs/examples';
const QUICK_START_URL = 'https://www.shipfox.io/docs/getting-started';

/** Where the panel is mounted, reported with every panel event. */
export type FirstWorkflowSurface = 'home' | 'workflows_empty';

/** The panel only exists while the first workflow is not done. */
export type FirstWorkflowPanelProgress = Exclude<FirstWorkflowProgress, {state: 'done'}>;

export interface FirstWorkflowPanelProps {
  workspace: WorkspaceReference;
  progress: FirstWorkflowPanelProgress;
  surface: FirstWorkflowSurface;
}

type PanelMode = 'choose' | 'finish';

export function FirstWorkflowPanel({workspace, progress, surface}: FirstWorkflowPanelProps) {
  const analytics = useClientAnalytics();
  const titleId = useId();
  const mode: PanelMode = progress.state === 'open' ? 'choose' : 'finish';
  const openedModes = useRef(new Set<PanelMode>());

  useEffect(() => {
    if (openedModes.current.has(mode)) return;
    openedModes.current.add(mode);
    analytics.capture('first_workflow_panel_opened', {surface, mode});
  }, [analytics, mode, surface]);

  const picker = <TemplatePicker workspace={workspace} surface={surface} />;

  return (
    <Panel asChild>
      <section aria-labelledby={titleId}>
        <PanelHeader className="flex-col items-start gap-tight">
          <PanelTitle id={titleId} variant="h2">
            {mode === 'choose' ? 'Create your first workflow' : 'Finish your first workflow'}
          </PanelTitle>
          {mode === 'choose' ? (
            <Text size="sm" className="text-foreground-neutral-muted">
              Pick a workflow. Your coding agent adapts it to this repository, tests it on a real
              run, and opens a pull request that adds it.
            </Text>
          ) : null}
        </PanelHeader>
        <PanelBody>
          {progress.state === 'open' ? (
            <>
              <PanelStep>
                <Text as="h3" size="sm" bold>
                  1. Connect your coding agent
                </Text>
                <McpConnectionStep workspaceId={workspace.id} />
              </PanelStep>
              <PanelStep>
                <Text as="h3" size="sm" bold>
                  2. Pick a workflow
                </Text>
                <Text size="sm" className="text-foreground-neutral-muted">
                  Copy a prompt and paste it into your coding agent from the repository.
                </Text>
              </PanelStep>
              {picker}
            </>
          ) : (
            <FinishSteps testRunId={progress.testRunId}>{picker}</FinishSteps>
          )}
        </PanelBody>
      </section>
    </Panel>
  );
}

/**
 * A step inside the panel body. Not a `PanelRow`: a step holds instructions,
 * not one record, so it takes no hover wash.
 */
function PanelStep({children}: {children: ReactNode}) {
  return (
    <div className="flex min-w-0 flex-col items-start gap-inline border-b border-border-neutral-base px-row py-row last:border-b-0">
      {children}
    </div>
  );
}

/**
 * Rendered only once the grant query has resolved, because an absent grant and
 * an unloaded one look the same and this step would otherwise ask a connected
 * user to connect again.
 */
function McpConnectionStep({workspaceId}: {workspaceId: string}) {
  const {grant, isPending} = useWorkspaceAgentGrant(workspaceId);
  if (isPending) return null;
  if (grant) return <ConnectedGrant grant={grant} />;
  return <McpSetupInstructions />;
}

function ConnectedGrant({grant}: {grant: WorkspaceAgentGrant}) {
  return (
    <Text size="sm" className="flex items-center gap-tight text-foreground-neutral-muted">
      <Icon
        name="checkCircleSolid"
        className="size-16 text-foreground-highlight-interactive"
        aria-hidden="true"
      />
      Connected: {grant.clientName}
    </Text>
  );
}

function FinishSteps({testRunId, children}: {testRunId: string; children: ReactNode}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <>
      <PanelStep>
        <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-inline">
          <Text size="sm" className="flex items-center gap-tight">
            <Icon
              name="checkCircleSolid"
              className="size-16 text-foreground-highlight-interactive"
              aria-hidden="true"
            />
            A test run succeeded.
          </Text>
          <Button asChild size="sm" variant="secondary">
            <Link to="/runs/$workflowRunId" params={{workflowRunId: testRunId}}>
              View run
            </Link>
          </Button>
        </div>
        <Text size="sm" className="text-foreground-neutral-muted">
          Merge the workflow pull request your coding agent opens. It adds the file under{' '}
          <InlineCode>.shipfox/workflows/</InlineCode>. Merging the task pull request does not turn
          the workflow on.
        </Text>
      </PanelStep>
      <Collapsible open={pickerOpen} onOpenChange={setPickerOpen}>
        <PanelStep>
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant="transparentMuted"
              iconRight={pickerOpen ? 'arrowUpSLine' : 'arrowDownSLine'}
            >
              Set up a different workflow
            </Button>
          </CollapsibleTrigger>
        </PanelStep>
        <CollapsibleContent>{children}</CollapsibleContent>
      </Collapsible>
    </>
  );
}

function TemplatePicker({
  workspace,
  surface,
}: {
  workspace: WorkspaceReference;
  surface: FirstWorkflowSurface;
}) {
  const analytics = useClientAnalytics();
  const templatesQuery = useWorkspaceWorkflowTemplatesQuery(workspace.id);
  const suggestions = templatesQuery.data ? suggestWorkflowTemplates(templatesQuery.data) : null;

  function captureCopy(template: WorkflowTemplate | undefined) {
    analytics.capture(
      'first_workflow_prompt_copied',
      template
        ? {surface, template_id: template.id, group: template.group}
        : {surface, template_id: 'generic'},
    );
  }

  return (
    <>
      {templatesQuery.isPending ? <TemplateCardsSkeleton /> : null}
      {templatesQuery.isError && !suggestions ? (
        <PanelStep>
          <Text size="sm" className="text-foreground-neutral-muted">
            Suggested workflows could not load. Browse the examples or describe what you want to
            your coding agent.
          </Text>
        </PanelStep>
      ) : null}
      {suggestions && suggestions.cards.length > 0 ? (
        <PanelGrid aria-label="Suggested workflows" className="border-b border-border-neutral-base">
          {suggestions.cards.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              onCopied={() => captureCopy(template)}
            />
          ))}
        </PanelGrid>
      ) : null}
      {suggestions && suggestions.needsConnection.length > 0 ? (
        <PanelStep>
          <Text size="sm" className="text-foreground-neutral-muted">
            Needs a connection
          </Text>
          <ul className="flex flex-col gap-tight">
            {suggestions.needsConnection.map((template) => (
              <li key={template.id}>
                <ButtonLink asChild variant="interactive" size="sm">
                  <Link
                    to="/w/$workspaceSlug/settings/integrations"
                    params={{workspaceSlug: workspace.slug}}
                  >
                    {needsConnectionLabel(template)}
                  </Link>
                </ButtonLink>
              </li>
            ))}
          </ul>
        </PanelStep>
      ) : null}
      <PanelStep>
        <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-inline">
          <div className="flex min-w-0 flex-col gap-tight">
            <Text size="sm" bold>
              Something else
            </Text>
            <Text size="sm" className="text-foreground-neutral-muted">
              Your coding agent recommends a workflow or writes one for this repository.
            </Text>
          </div>
          <CopyPromptButton
            prompt={FIRST_WORKFLOW_PROMPT}
            subject="something else"
            onCopied={() => captureCopy(undefined)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-group">
          <ButtonLink
            href={EXAMPLES_URL}
            target="_blank"
            rel="noreferrer"
            variant="interactive"
            iconRight="externalLink"
          >
            Browse all examples
          </ButtonLink>
          <ButtonLink
            href={QUICK_START_URL}
            target="_blank"
            rel="noreferrer"
            variant="muted"
            iconRight="externalLink"
          >
            Read the Quick Start
          </ButtonLink>
        </div>
      </PanelStep>
    </>
  );
}

function needsConnectionLabel(template: WorkflowTemplate): string {
  const providers = joinProviderNames(template.missingProviders.map(providerDisplayName));
  return `Connect ${providers} to use ${template.title}`;
}

function providerDisplayName(provider: string): string {
  return PROVIDER_CATALOG[provider]?.displayName ?? provider;
}

function TemplateCard({template, onCopied}: {template: WorkflowTemplate; onCopied: () => void}) {
  const providerNames = joinProviderNames(template.providers.map(providerDisplayName));

  return (
    <PanelCell className="gap-inline px-row py-row">
      <div className="flex min-w-0 items-center justify-between gap-inline">
        <Badge
          variant={template.group === 'try_now' ? 'info' : 'neutral'}
          className="min-w-0 shrink"
        >
          <span className="min-w-0 truncate">{workflowTemplateCardLabel(template)}</span>
        </Badge>
        <span className="flex shrink-0 items-center gap-tight" title={`Uses ${providerNames}`}>
          {template.providers.map((provider) => {
            const iconName = PROVIDER_CATALOG[provider]?.iconName;
            return iconName ? (
              <Icon
                key={provider}
                name={iconName}
                className="size-16 text-foreground-neutral-muted"
                aria-hidden="true"
              />
            ) : null;
          })}
          <span className="sr-only">Uses {providerNames}</span>
        </span>
      </div>
      <Text as="h4" size="md" bold>
        {template.title}
      </Text>
      <Text size="sm" className="flex-1 text-foreground-neutral-muted">
        {template.summary}
      </Text>
      <CopyPromptButton prompt={template.prompt} subject={template.title} onCopied={onCopied} />
    </PanelCell>
  );
}

function TemplateCardsSkeleton() {
  return (
    <PanelGrid aria-hidden="true" className="border-b border-border-neutral-base">
      {[0, 1].map((index) => (
        <PanelCell key={index} className="gap-inline px-row py-row">
          <Skeleton className="h-20 w-96" />
          <Skeleton className="h-20 w-160" />
          <Skeleton className="h-40 w-full" />
        </PanelCell>
      ))}
    </PanelGrid>
  );
}

function CopyPromptButton({
  prompt,
  subject,
  onCopied,
}: {
  prompt: string;
  subject: string;
  onCopied: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const {copy} = useCopyToClipboard({
    text: prompt,
    onCopy: () => {
      setCopied(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopied(false), 2000);
      onCopied();
    },
  });

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  async function handleCopy() {
    try {
      await copy();
    } catch {
      toast.error('Could not copy the prompt. Try again.');
    }
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      className="shrink-0 self-start"
      iconLeft={copied ? 'check' : 'copy'}
      aria-label={`${copied ? 'Copied prompt' : 'Copy prompt'} for ${subject}`}
      onClick={() => void handleCopy()}
    >
      {copied ? 'Copied' : 'Copy prompt'}
    </Button>
  );
}

function InlineCode({children}: {children: string}) {
  return (
    <Code as="code" variant="label" className="rounded-4 bg-background-components-base px-tight">
      {children}
    </Code>
  );
}
