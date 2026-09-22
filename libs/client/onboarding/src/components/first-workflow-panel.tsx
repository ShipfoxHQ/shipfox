import {useClientAnalytics} from '@shipfox/client-shell/runtime';
import {Button} from '@shipfox/react-ui/button';
import {useCopyToClipboard} from '@shipfox/react-ui/hooks';
import {Panel, PanelBody, PanelHeader, PanelRow, PanelTitle} from '@shipfox/react-ui/panel';
import {toast} from '@shipfox/react-ui/toast';
import {Code, Text} from '@shipfox/react-ui/typography';
import {Link} from '@tanstack/react-router';
import {useEffect, useId, useRef, useState} from 'react';

export const FIRST_WORKFLOW_PROMPT =
  'Set up a Shipfox workflow for this repository. Use the Shipfox MCP server: call `get_workflow_setup_guide` and follow it.';

const GETTING_STARTED_URL = 'https://www.shipfox.io/docs/getting-started';

export interface FirstWorkflowPanelProps {
  workspaceSlug: string;
}

export function FirstWorkflowPanel({workspaceSlug}: FirstWorkflowPanelProps) {
  const analytics = useClientAnalytics();
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
              <Text size="sm" className="text-foreground-neutral-muted">
                Connect your coding agent so it can read your workspace and guide the setup.
              </Text>
              <Button asChild size="sm" variant="secondary">
                <Link to="/w/$workspaceSlug/settings/agent-access" params={{workspaceSlug}}>
                  Connect MCP server
                </Link>
              </Button>
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
          <div className="flex justify-end border-t border-border-neutral-base px-row py-row">
            <a href={GETTING_STARTED_URL}>Use the manual quickstart</a>
          </div>
        </PanelBody>
      </section>
    </Panel>
  );
}
