import {resolveApiUrl} from '@shipfox/client-api';
import {Button} from '@shipfox/react-ui/button';
import {useCopyToClipboard} from '@shipfox/react-ui/hooks';
import {Panel} from '@shipfox/react-ui/panel';
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@shipfox/react-ui/tabs';
import {toast} from '@shipfox/react-ui/toast';
import {Code, Header, Text} from '@shipfox/react-ui/typography';
import {useId} from 'react';

export function McpSetup() {
  const titleId = useId();
  const endpoint = new URL(resolveApiUrl('/mcp'), window.location.origin).href;
  const quotedEndpoint = `'${endpoint.replaceAll("'", "'\\''")}'`;
  const cursorConfig = JSON.stringify({mcpServers: {shipfox: {url: endpoint}}}, null, 2);
  const vsCodeConfig = JSON.stringify({servers: {shipfox: {type: 'http', url: endpoint}}}, null, 2);

  return (
    <section className="flex min-w-0 flex-col gap-group" aria-labelledby={titleId}>
      <div className="flex flex-col gap-tight">
        <Header id={titleId} variant="h3">
          Connect an MCP app
        </Header>
        <Text size="sm" className="text-foreground-neutral-muted">
          Connect Claude, Codex, Cursor, VS Code, or another MCP app to the Shipfox MCP server.
        </Text>
      </div>
      <Panel>
        <div className="border-b border-border-neutral-base p-panel-compact">
          <SetupCode label="Shipfox MCP server endpoint" code={endpoint} showLabel />
        </div>
        <div className="flex flex-col gap-group p-panel-compact">
          <Tabs defaultValue="claude-code">
            <TabsList aria-label="Setup instructions">
              <TabsTrigger value="claude-code">Claude Code</TabsTrigger>
              <TabsTrigger value="codex">Codex</TabsTrigger>
              <TabsTrigger value="cursor">Cursor</TabsTrigger>
              <TabsTrigger value="vscode">VS Code</TabsTrigger>
              <TabsTrigger value="claude">Claude app</TabsTrigger>
            </TabsList>
            <TabsContent value="claude-code" className="flex flex-col gap-inline pt-panel-compact">
              <Text size="sm">Run this command in your terminal:</Text>
              <SetupCode
                label="Claude Code command"
                code={`claude mcp add --transport http shipfox ${quotedEndpoint}`}
              />
              <Text size="sm">
                Open Claude Code and run <InlineCode>/mcp</InlineCode>. Select Shipfox and follow
                the sign-in steps in your browser.
              </Text>
            </TabsContent>
            <TabsContent value="codex" className="flex flex-col gap-inline pt-panel-compact">
              <Text size="sm">Run these commands in your terminal to add Shipfox and sign in:</Text>
              <SetupCode
                label="Codex commands"
                code={`codex mcp add shipfox --url ${quotedEndpoint}\ncodex mcp login shipfox`}
              />
            </TabsContent>
            <TabsContent value="cursor" className="flex flex-col gap-inline pt-panel-compact">
              <Text size="sm">
                Add this entry to <InlineCode>.cursor/mcp.json</InlineCode> in your project, or to{' '}
                <InlineCode>~/.cursor/mcp.json</InlineCode> for every project:
              </Text>
              <SetupCode label="Cursor configuration" code={cursorConfig} />
              <Text size="sm">
                Open Customize from the Cursor sidebar to see the server. Cursor opens the sign-in
                steps in your browser when it first connects to Shipfox.
              </Text>
            </TabsContent>
            <TabsContent value="vscode" className="flex flex-col gap-inline pt-panel-compact">
              <Text size="sm">
                Add this entry to <InlineCode>.vscode/mcp.json</InlineCode> in your project:
              </Text>
              <SetupCode label="VS Code configuration" code={vsCodeConfig} />
              <Text size="sm">
                Run MCP: List Servers, select Shipfox, and start it. VS Code asks you to approve the
                sign-in and opens your browser.
              </Text>
            </TabsContent>
            <TabsContent value="claude" className="flex flex-col gap-inline pt-panel-compact">
              <Text size="sm">
                In Claude on web or desktop, open Settings → Connectors → Add custom connector. Name
                it Shipfox, paste the Shipfox MCP server endpoint above as the remote server URL,
                then connect and sign in.
              </Text>
            </TabsContent>
          </Tabs>
          <Text size="sm" className="text-foreground-neutral-muted">
            When the Shipfox access page opens, select this workspace and review the requested
            access. Other MCP apps can use the same endpoint with OAuth.
          </Text>
        </div>
      </Panel>
    </section>
  );
}

function InlineCode({children}: {children: string}) {
  return (
    <Code as="code" variant="label" className="rounded-4 bg-background-components-base px-tight">
      {children}
    </Code>
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
