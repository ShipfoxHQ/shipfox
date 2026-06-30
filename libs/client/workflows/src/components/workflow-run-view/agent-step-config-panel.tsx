import {Code, Text} from '@shipfox/react-ui';
import type {WorkflowAgentStepConfig} from '#core/workflow-run.js';

export function AgentStepConfigPanel({config}: {config: WorkflowAgentStepConfig}) {
  return (
    <section aria-label="Resolved agent configuration" className="flex min-w-0 flex-col gap-6">
      <Text as="h3" size="xs" bold className="text-foreground-neutral-subtle">
        Resolved agent configuration
      </Text>
      <dl className="grid min-w-0 gap-8 sm:grid-cols-3">
        <AgentConfigValue label="Provider" value={config.provider} />
        <AgentConfigValue label="Model" value={config.model} />
        <AgentConfigValue label="Thinking" value={config.thinking} />
      </dl>
    </section>
  );
}

function AgentConfigValue({label, value}: {label: string; value: string | null}) {
  return (
    <div className="min-w-0">
      <Text as="dt" size="xs" className="text-foreground-neutral-muted">
        {label}
      </Text>
      <Code
        as="dd"
        variant="label"
        className={
          value ? 'truncate text-foreground-neutral-base' : 'text-foreground-neutral-muted'
        }
      >
        {value ?? 'Not recorded'}
      </Code>
    </div>
  );
}
