import {useClientAnalytics} from '@shipfox/client-shell/runtime';
import {Button} from '@shipfox/react-ui/button';
import {useCopyToClipboard} from '@shipfox/react-ui/hooks';
import {Icon} from '@shipfox/react-ui/icon';
import {Panel, PanelBody, PanelHeader, PanelRow, PanelTitle} from '@shipfox/react-ui/panel';
import {toast} from '@shipfox/react-ui/toast';
import {Code, Text} from '@shipfox/react-ui/typography';
import {Link} from '@tanstack/react-router';
import {useEffect, useId, useRef, useState} from 'react';
import {useWorkspaceAgentGrant, type WorkspaceAgentGrant} from '#hooks/api/agent-grants.js';
import type {WorkspaceReference} from './setup-checklist-types.js';

export const FIRST_WORKFLOW_PROMPT =
  "Set up a Shipfox workflow for this repository: read the Shipfox MCP server's `create-workflow-from-template` skill and follow it.";

export interface FirstWorkflowPanelProps {
  workspace: WorkspaceReference;
}

export function FirstWorkflowPanel({workspace}: FirstWorkflowPanelProps) {
  const analytics = useClientAnalytics();
  const {grant: connectedGrant, isPending: grantPending} = useWorkspaceAgentGrant(workspace.id);
  const titleId = useId();
  const panelOpened = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const {copy} = useCopyToClipboard({
    text: FIRST_WORKFLOW_PROMPT,
    onCopy: () => {
      setCopied(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopied(false), 2000);
      analytics.capture('first_workflow_prompt_copied');
    },
  });

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (panelOpened.current) return;
    panelOpened.current = true;
    analytics.capture('first_workflow_panel_opened');
  }, [analytics]);

  async function handleCopy() {
    try {
      await copy();
    } catch {
      toast.error('Could not copy. Select and copy the prompt manually.');
    }
  }

  return (
    <Panel asChild>
      <section aria-labelledby={titleId}>
        <PanelHeader variant="plain" className="flex-col items-start gap-inline">
          <PanelTitle id={titleId} variant="h2">
            Create your first workflow
          </PanelTitle>
          <Text size="sm" className="text-foreground-neutral-muted">
            Use your coding agent to set up a workflow for this repository.
          </Text>
        </PanelHeader>
        <PanelBody>
          <PanelRow className="items-start">
            <div className="flex min-w-0 flex-1 flex-col items-start gap-inline">
              <Text as="h3" size="sm" bold>
                1. Connect the Shipfox MCP server
              </Text>
              {grantPending ? null : (
                <McpConnectionStep grant={connectedGrant} workspaceSlug={workspace.slug} />
              )}
            </div>
          </PanelRow>
          <PanelRow className="items-start">
            <div className="flex min-w-0 flex-1 flex-col items-start gap-inline">
              <Text as="h3" size="sm" bold>
                2. Copy the setup prompt
              </Text>
              <Text size="sm" className="text-foreground-neutral-muted">
                Paste this prompt into your coding agent from the repository.
              </Text>
              <div className="flex w-full min-w-0 items-start gap-inline">
                <Code
                  as="pre"
                  variant="paragraph"
                  className="min-w-0 flex-1 whitespace-pre-wrap break-words rounded-4 bg-background-components-base p-panel-compact text-foreground-neutral-base"
                >
                  {FIRST_WORKFLOW_PROMPT}
                </Code>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  iconLeft={copied ? 'check' : 'copy'}
                  onClick={() => void handleCopy()}
                >
                  {copied ? 'Copied' : 'Copy prompt'}
                </Button>
              </div>
            </div>
          </PanelRow>
        </PanelBody>
      </section>
    </Panel>
  );
}

/**
 * Rendered only once the grant query has resolved, because an absent grant and
 * an unloaded one look the same and this step would otherwise ask a connected
 * user to connect again.
 */
function McpConnectionStep({
  grant,
  workspaceSlug,
}: {
  grant: WorkspaceAgentGrant | undefined;
  workspaceSlug: string;
}) {
  if (grant) return <ConnectedGrant clientName={grant.clientName} />;

  return (
    <>
      <Text size="sm" className="text-foreground-neutral-muted">
        Connect your coding agent so it can read your workspace and guide the setup.
      </Text>
      <Button asChild size="sm" variant="secondary">
        <Link to="/w/$workspaceSlug/settings/agent-access" params={{workspaceSlug}}>
          Connect MCP server
        </Link>
      </Button>
    </>
  );
}

function ConnectedGrant({clientName}: {clientName: string}) {
  return (
    <Text size="sm" className="flex items-center gap-tight text-foreground-neutral-muted">
      <Icon
        name="checkCircleSolid"
        className="size-16 text-foreground-highlight-interactive"
        aria-hidden="true"
      />
      Connected: {clientName}
    </Text>
  );
}
