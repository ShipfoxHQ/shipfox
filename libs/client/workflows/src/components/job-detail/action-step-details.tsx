import {PROVIDER_CATALOG} from '@shipfox/client-integrations';
import {useStepAttemptLogsQuery} from '@shipfox/client-logs';
import {Badge} from '@shipfox/react-ui/badge';
import {Icon} from '@shipfox/react-ui/icon';
import {
  InspectorSection,
  InspectorSectionEmpty,
  JsonPropertyList,
  PropertyList,
  PropertyRow,
} from '@shipfox/react-ui/inspector';
import {
  type ActionStepConfig,
  actionSourceLabel,
  presentedActionInputs,
  readActionRuntime,
  shortActionDigest,
} from '#core/action-step.js';
import {useWorkflowRunOverviewQuery} from '#hooks/api/workflow-run-overview.js';

export function ActionStepDetails({
  config,
  stepLabel,
  stepId,
  attempt,
  workflowRunId,
  runAttempt,
}: {
  config: ActionStepConfig;
  stepLabel: string;
  stepId: string;
  attempt: number;
  workflowRunId: string;
  runAttempt: number;
}) {
  const inputs = presentedActionInputs(config);
  const inputCount = Object.keys(inputs).length;
  return (
    <>
      <ActionIdentitySection
        config={config}
        stepLabel={stepLabel}
        stepId={stepId}
        attempt={attempt}
        workflowRunId={workflowRunId}
        runAttempt={runAttempt}
      />
      <InspectorSection title="Inputs" count={inputCount || undefined}>
        {inputCount === 0 ? (
          <InspectorSectionEmpty>No inputs were passed to this action.</InspectorSectionEmpty>
        ) : (
          <JsonPropertyList value={inputs} copyLabel={(name) => `Copy input ${name}`} />
        )}
      </InspectorSection>
      <InspectorSection title="Integrations" count={config.bindings.length || undefined}>
        {config.bindings.length === 0 ? (
          <InspectorSectionEmpty>This action declares no integrations.</InspectorSectionEmpty>
        ) : (
          <PropertyList>
            {config.bindings.map((binding) => (
              <PropertyRow key={binding.alias} label={binding.alias} labelFont="code">
                <span className="flex min-w-0 flex-col gap-tight">
                  <span className="inline-flex min-w-0 items-center gap-inline">
                    <Icon
                      name={PROVIDER_CATALOG[binding.provider]?.iconName ?? 'componentLine'}
                      size={14}
                      aria-hidden="true"
                      className="shrink-0 text-foreground-neutral-muted"
                    />
                    <span className="truncate">
                      {PROVIDER_CATALOG[binding.provider]?.displayName ?? binding.provider} ·{' '}
                      <span className="font-code">{binding.connectionSlug}</span>
                    </span>
                  </span>
                  {binding.tools.length > 0 ? (
                    <ul
                      aria-label={`Tools granted to ${binding.alias}`}
                      className="flex flex-col gap-tight"
                    >
                      {binding.tools.map((tool) => (
                        <li key={tool.id} className="flex min-w-0 items-center gap-inline">
                          <span className="truncate font-code">{tool.id}</span>
                          <Badge
                            variant={tool.sensitivity === 'write' ? 'warning' : 'neutral'}
                            size="2xs"
                            radius="rounded"
                          >
                            {tool.sensitivity === 'write' ? 'Write' : 'Read'}
                          </Badge>
                          {tool.result === 'file' ? (
                            <Badge variant="neutral" size="2xs" radius="rounded">
                              File
                            </Badge>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </span>
              </PropertyRow>
            ))}
          </PropertyList>
        )}
      </InspectorSection>
    </>
  );
}

function ActionIdentitySection({
  config,
  stepLabel,
  stepId,
  attempt,
  workflowRunId,
  runAttempt,
}: {
  config: ActionStepConfig;
  stepLabel: string;
  stepId: string;
  attempt: number;
  workflowRunId: string;
  runAttempt: number;
}) {
  const logs = useStepAttemptLogsQuery(stepId, attempt);
  const runtime = readActionRuntime(logs.data?.records ?? []);
  const overview = useWorkflowRunOverviewQuery({workflowRunId, runAttempt});
  const source = overview.data ? actionSourceLabel(overview.data) : null;
  return (
    <InspectorSection title="Action">
      <PropertyList>
        {/* The step label is usually the action name; show the name only when it adds something. */}
        {config.name && config.name !== stepLabel ? (
          <PropertyRow label="Name">{config.name}</PropertyRow>
        ) : null}
        <PropertyRow label="Uses" copyValue={config.uses} copyLabel="Copy uses path">
          <span className="break-all font-code">{config.uses}</span>
        </PropertyRow>
        {config.digest ? (
          <PropertyRow label="Snapshot" copyValue={config.digest} copyLabel="Copy snapshot digest">
            <span className="font-code">{shortActionDigest(config.digest)}</span>
          </PropertyRow>
        ) : null}
        {source ? (
          <PropertyRow label="Source">
            <span className="font-code">{source}</span>
          </PropertyRow>
        ) : null}
        {runtime ? (
          <PropertyRow label="Runtime">
            <span className="font-code">
              node {runtime.node} · @shipfox/actions {runtime.sdk}
            </span>
          </PropertyRow>
        ) : null}
      </PropertyList>
    </InspectorSection>
  );
}
