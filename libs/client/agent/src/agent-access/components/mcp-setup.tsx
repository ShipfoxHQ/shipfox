import {resolveApiUrl} from '@shipfox/client-api';
import {Button} from '@shipfox/react-ui/button';
import {useCopyToClipboard} from '@shipfox/react-ui/hooks';
import {Panel} from '@shipfox/react-ui/panel';
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@shipfox/react-ui/tabs';
import {toast} from '@shipfox/react-ui/toast';
import {Code, Header, Text} from '@shipfox/react-ui/typography';

export function McpSetup() {
  const endpoint = new URL(resolveApiUrl('/mcp'), window.location.origin).href;
  const quotedEndpoint = `'${endpoint.replaceAll("'", "'\\''")}'`;

  return (
    <section className="flex min-w-0 flex-col gap-group" aria-labelledby="mcp-setup-title">
      <div className="flex flex-col gap-tight">
        <Header id="mcp-setup-title" variant="h3">
          Connect your agent
        </Header>
        <Text size="sm" className="text-foreground-neutral-muted">
          Give Claude, Codex, or another MCP app access to your Shipfox workspace.
        </Text>
      </div>
      <Panel>
        <div className="border-b border-border-neutral-base p-panel-compact">
          <SetupCode label="MCP endpoint" code={endpoint} showLabel />
        </div>
        <div className="flex flex-col gap-group p-panel-compact">
          <Tabs defaultValue="claude-code">
            <TabsList aria-label="Setup instructions">
              <TabsTrigger value="claude-code">Claude Code</TabsTrigger>
              <TabsTrigger value="codex">Codex</TabsTrigger>
              <TabsTrigger value="claude">Claude app</TabsTrigger>
            </TabsList>
            <TabsContent value="claude-code" className="flex flex-col gap-inline pt-panel-compact">
              <Text size="sm">Run this command in your terminal:</Text>
              <SetupCode
                label="Claude Code command"
                code={`claude mcp add --transport http shipfox ${quotedEndpoint}`}
              />
              <Text size="sm">
                Open Claude Code and run{' '}
                <Code
                  as="code"
                  variant="label"
                  className="rounded-4 bg-background-components-base px-tight"
                >
                  /mcp
                </Code>
                . Select Shipfox and follow the sign-in steps in your browser.
              </Text>
            </TabsContent>
            <TabsContent value="codex" className="flex flex-col gap-inline pt-panel-compact">
              <Text size="sm">Run these commands in your terminal to add Shipfox and sign in:</Text>
              <SetupCode
                label="Codex commands"
                code={`codex mcp add shipfox --url ${quotedEndpoint}\ncodex mcp login shipfox`}
              />
            </TabsContent>
            <TabsContent value="claude" className="flex flex-col gap-inline pt-panel-compact">
              <Text size="sm">
                In Claude on web or desktop, open Settings → Connectors → Add custom connector. Name
                it Shipfox, paste the MCP endpoint above as the remote server URL, then connect and
                sign in.
              </Text>
            </TabsContent>
          </Tabs>
          <Text size="sm" className="text-foreground-neutral-muted">
            When Shipfox opens, select this workspace and review the requested access. Once you
            approve, the app will appear below. Other MCP apps can use the same endpoint with OAuth.
          </Text>
        </div>
      </Panel>
    </section>
  );
}

function SetupCode({
  label,
  code,
  showLabel = false,
}: {
  label: string;
  code: string;
  showLabel?: boolean;
}) {
  const {copy} = useCopyToClipboard({text: code});

  async function handleCopy() {
    try {
      await copy();
      toast.success('Copied to clipboard.');
    } catch {
      toast.error('Could not copy. Select and copy the text manually.');
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-inline">
      {showLabel ? (
        <Text size="sm" className="text-foreground-neutral-muted">
          {label}
        </Text>
      ) : null}
      <div className="flex min-w-0 items-start gap-inline rounded-4 bg-background-components-base p-tight">
        <Code
          as="pre"
          variant="label"
          className="min-w-0 flex-1 self-center whitespace-pre-wrap break-all"
        >
          <code>{code}</code>
        </Code>
        <Button
          type="button"
          variant="transparentMuted"
          size="xs"
          iconLeft="copy"
          aria-label={`Copy ${label}`}
          title={`Copy ${label}`}
          onClick={() => void handleCopy()}
        />
      </div>
    </div>
  );
}
