import {McpSetupInstructions} from '@shipfox/client-agent';
import {PROVIDER_CATALOG} from '@shipfox/client-integrations';
import {useClientAnalytics} from '@shipfox/client-shell/runtime';
import {Button, ButtonLink, IconButton} from '@shipfox/react-ui/button';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@shipfox/react-ui/collapsible';
import {useCopyToClipboard} from '@shipfox/react-ui/hooks';
import {Icon} from '@shipfox/react-ui/icon';
import {
  Panel,
  PanelActions,
  PanelBody,
  PanelHeader,
  PanelRow,
  PanelTitle,
} from '@shipfox/react-ui/panel';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {toast} from '@shipfox/react-ui/toast';
import {Code, Text} from '@shipfox/react-ui/typography';
import {FIRST_WORKFLOW_PROMPT} from '@shipfox/workflow-templates/prompt';
import {Link} from '@tanstack/react-router';
import {type ReactNode, useEffect, useId, useRef, useState} from 'react';
import type {FirstWorkflowProgress} from '#core/setup-checklist.js';
import {
  suggestWorkflowTemplates,
  type WorkflowTemplate,
  workflowTemplateLabel,
} from '#core/workflow-templates.js';
import {useWorkspaceAgentGrant, type WorkspaceAgentGrant} from '#hooks/api/agent-grants.js';
import {useWorkspaceWorkflowTemplatesQuery} from '#hooks/api/workflow-templates.js';
import type {WorkspaceReference} from './setup-checklist-types.js';

export {FIRST_WORKFLOW_PROMPT};

const EXAMPLES_URL = 'https://www.shipfox.io/docs/examples';

/** Where the panel is mounted, reported with every panel event. */
export type FirstWorkflowSurface = 'home' | 'workflows_empty';

/** The panel only exists while the first workflow is not done. */
export type FirstWorkflowPanelProgress = Exclude<FirstWorkflowProgress, {state: 'done'}>;

export interface FirstWorkflowPanelProps {
  workspace: WorkspaceReference;
  progress: FirstWorkflowPanelProgress;
  surface: FirstWorkflowSurface;
  /** Adds a close button that hides the setup guide. The home passes it. */
  onDismiss?: (() => void) | undefined;
  /** Moves focus to the title on mount, when the panel replaces another step. */
  focusTitle?: boolean;
}

type PanelMode = 'choose' | 'finish';

export function FirstWorkflowPanel({
  workspace,
  progress,
  surface,
  onDismiss,
  focusTitle = false,
}: FirstWorkflowPanelProps) {
  const analytics = useClientAnalytics();
  const titleId = useId();
  // Mount only: the flag says how the panel arrived, not a state to follow.
  const focusOnMount = useRef(focusTitle);
  useEffect(() => {
    if (focusOnMount.current) document.getElementById(titleId)?.focus();
  }, [titleId]);
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
        <PanelHeader className="items-start">
          <div className="flex min-w-0 flex-col gap-tight">
            <PanelTitle id={titleId} tabIndex={-1} variant="h2">
              {mode === 'choose' ? 'Create your first workflow' : 'Finish your first workflow'}
            </PanelTitle>
            {mode === 'choose' ? (
              <Text size="sm" className="text-foreground-neutral-muted">
                Pick a workflow. Your coding agent adapts it to this repository, tests it on a real
                run, and opens a pull request that adds it.
              </Text>
            ) : null}
          </div>
          {onDismiss ? (
            <PanelActions>
              <IconButton
                type="button"
                variant="transparent"
                size="sm"
                muted
                icon="close"
                aria-label="Hide setup guide"
                onClick={onDismiss}
              />
            </PanelActions>
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
      {templatesQuery.isPending ? <SuggestionsSkeleton /> : null}
      {templatesQuery.isError && !suggestions ? (
        <PanelStep>
          <Text size="sm" className="text-foreground-neutral-muted">
            Suggested workflows could not load. Browse the examples or describe what you want to
            your coding agent.
          </Text>
        </PanelStep>
      ) : null}
      {suggestions?.recommended ? (
        <RecommendedTemplate
          template={suggestions.recommended}
          onCopied={() => captureCopy(suggestions.recommended)}
        />
      ) : null}
      {suggestions && suggestions.others.length > 0 ? (
        <ul aria-label="More suggested workflows" className="border-b border-border-neutral-base">
          {suggestions.others.map((template) => (
            <TemplateRow
              key={template.id}
              template={template}
              onCopied={() => captureCopy(template)}
            />
          ))}
        </ul>
      ) : null}
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-inline px-row py-row">
        <ButtonLink
          href={EXAMPLES_URL}
          target="_blank"
          rel="noreferrer"
          variant="interactive"
          iconRight="externalLink"
        >
          Browse all examples
        </ButtonLink>
        <div className="flex min-w-0 items-center gap-tight">
          <Text size="sm" className="text-foreground-neutral-muted">
            Something else?
          </Text>
          <CopyPromptButton
            prompt={FIRST_WORKFLOW_PROMPT}
            label="Copy a generic prompt"
            appearance="inline"
            onCopied={() => captureCopy(undefined)}
          />
        </div>
      </div>
    </>
  );
}

function RecommendedTemplate({
  template,
  onCopied,
}: {
  template: WorkflowTemplate;
  onCopied: () => void;
}) {
  return (
    <PanelStep>
      <div className="flex w-full min-w-0 items-start justify-between gap-group">
        <div className="flex min-w-0 flex-col gap-tight">
          <div className="flex min-w-0 items-center gap-inline">
            <Text size="xs" className="text-foreground-neutral-muted">
              Recommended · {workflowTemplateLabel(template)}
            </Text>
            <ProviderIcons providers={template.providers} />
          </div>
          <Text as="h4" size="md" bold>
            <TemplateLink template={template} />
          </Text>
          <Text size="sm" className="text-foreground-neutral-muted">
            {template.summary}
          </Text>
        </div>
        <CopyPromptButton
          prompt={template.prompt}
          label="Copy prompt"
          subject={template.title}
          onCopied={onCopied}
        />
      </div>
    </PanelStep>
  );
}

function TemplateRow({template, onCopied}: {template: WorkflowTemplate; onCopied: () => void}) {
  return (
    <PanelRow asChild className="min-h-40 py-tight">
      <li>
        <Text as="h4" size="sm" className="min-w-0 truncate">
          <TemplateLink template={template} />
        </Text>
        <div className="flex min-w-0 shrink items-center gap-tight">
          <ProviderIcons providers={template.providers} />
          <Text size="xs" className="min-w-0 truncate text-foreground-neutral-muted">
            {workflowTemplateLabel(template)}
          </Text>
          <CopyPromptButton
            prompt={template.prompt}
            label="Copy prompt"
            subject={template.title}
            appearance="icon"
            onCopied={onCopied}
          />
        </div>
      </li>
    </PanelRow>
  );
}

/** The template's example page in the docs, which walks through what it does. */
function TemplateLink({template}: {template: WorkflowTemplate}) {
  return (
    <a
      href={`${EXAMPLES_URL}/${encodeURIComponent(template.id)}`}
      target="_blank"
      rel="noreferrer"
      className="rounded-4 underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
    >
      {template.title}
    </a>
  );
}

const providerNameList = new Intl.ListFormat('en', {type: 'conjunction'});

function ProviderIcons({providers}: {providers: readonly string[]}) {
  const entries = providers.flatMap((provider) => {
    const entry = PROVIDER_CATALOG[provider];
    return entry ? [{provider, ...entry}] : [];
  });
  if (entries.length === 0) return null;
  const label = `Uses ${providerNameList.format(entries.map(({displayName}) => displayName))}`;

  return (
    <span className="flex shrink-0 items-center gap-tight" title={label}>
      {entries.map(({provider, iconName}) => (
        <Icon
          key={provider}
          name={iconName}
          className="size-14 text-foreground-neutral-muted"
          aria-hidden="true"
        />
      ))}
      <span className="sr-only">{label}</span>
    </span>
  );
}

function SuggestionsSkeleton() {
  return (
    <div aria-hidden="true" className="border-b border-border-neutral-base">
      <div className="flex flex-col gap-tight px-row py-row">
        <Skeleton className="h-16 w-120" />
        <Skeleton className="h-20 w-160" />
        <Skeleton className="h-16 w-3/4" />
      </div>
    </div>
  );
}

/**
 * `subject` names the template for assistive tech when the visible label alone
 * would repeat on every row.
 */
function CopyPromptButton({
  prompt,
  label,
  subject,
  appearance = 'button',
  onCopied,
}: {
  prompt: string;
  label: string;
  subject?: string;
  appearance?: 'button' | 'icon' | 'inline';
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

  const visibleLabel = copied ? 'Copied' : label;
  const accessibleName = subject
    ? `${copied ? 'Copied prompt' : 'Copy prompt'} for ${subject}`
    : undefined;

  if (appearance === 'icon') {
    return (
      <Button
        type="button"
        size="xs"
        variant="transparentMuted"
        className="shrink-0"
        iconLeft={copied ? 'check' : 'copy'}
        aria-label={accessibleName ?? visibleLabel}
        title={accessibleName ?? visibleLabel}
        onClick={() => void handleCopy()}
      />
    );
  }

  return (
    <Button
      type="button"
      size="sm"
      variant={appearance === 'inline' ? 'transparent' : 'secondary'}
      className="shrink-0"
      iconLeft={copied ? 'check' : 'copy'}
      aria-label={accessibleName}
      onClick={() => void handleCopy()}
    >
      {visibleLabel}
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
