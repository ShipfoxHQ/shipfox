import {highlight} from 'fumadocs-core/highlight';
import {CodeBlock, Pre} from 'fumadocs-ui/components/codeblock';
import {AGENT_HANDOFF_LEAD_IN} from '@/lib/agent-handoff-lead-in';

// `skill` only matters to the MCP rendering, which `machine-readable.ts` generates.
export async function AgentHandoff({prompt}: {skill: string; prompt: string}) {
  return (
    <>
      <p>{AGENT_HANDOFF_LEAD_IN}</p>
      <CodeBlock data-docs-code-block="">
        {await highlight(prompt, {lang: 'text', components: {pre: Pre}})}
      </CodeBlock>
    </>
  );
}
