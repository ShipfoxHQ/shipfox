import type {WorkflowTemplateFlowStep, WorkflowTemplateWrite} from '@shipfox/workflow-templates';
import {
  Bot,
  CircleCheck,
  CornerLeftUp,
  type LucideIcon,
  PenLine,
  UserRound,
  Wrench,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import type {TemplateDetails} from '@/lib/package-page';
import {providerLabel} from '@/lib/providers';
import {packagePath} from '@/lib/urls';
import {ProviderIcon} from './provider-icon';
import {CodeName, InlineCode, Row, RowList, Section} from './section';

const FLOW_ICONS: Record<WorkflowTemplateFlowStep['kind'], LucideIcon> = {
  trigger: Zap,
  agent: Bot,
  check: CircleCheck,
  tool: Wrench,
  write: PenLine,
  human: UserRound,
};

export function TemplateSections({details}: {details: TemplateDetails}) {
  const {manifest, metadata, actions} = details;
  const {slots, secrets, variables} = metadata.interface;
  return (
    <>
      {manifest.flow.length > 0 ? (
        <Section title="How it works">
          <Flow steps={manifest.flow} />
        </Section>
      ) : null}

      {manifest.writes.length > 0 ? (
        <Section title="What it writes">
          <RowList>
            {groupWrites(manifest.writes).map(([provider, writes]) => (
              <li
                key={provider ?? ''}
                className="flex items-start gap-cluster px-row py-row text-sm"
              >
                {provider === undefined ? null : (
                  <span className="flex w-96 shrink-0 items-center gap-inline font-medium text-foreground-neutral-base">
                    <ProviderIcon provider={provider} className="size-16" />
                    {providerLabel(provider)}
                  </span>
                )}
                <ul className="flex flex-col gap-tight text-foreground-neutral-subtle">
                  {writes.map((write) => (
                    <li key={write}>{write}</li>
                  ))}
                </ul>
              </li>
            ))}
          </RowList>
        </Section>
      ) : null}

      {manifest.prerequisites.length > 0 ? (
        <Section title="Before you start">
          <ul className="flex list-disc flex-col gap-inline pl-20 text-sm text-foreground-neutral-base">
            {manifest.prerequisites.map((item) => (
              <li key={item}>
                <InlineCode text={item} />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Choices you make">
        <p className="text-sm text-foreground-neutral-subtle">
          When you set up this workflow, your coding agent asks you these questions.
        </p>
        <RowList>
          {metadata.choices.roles.map((role) => (
            <Row key={role.id}>
              <span className="font-medium text-foreground-neutral-base">
                {role.question ?? `Which ${role.id}?`}
              </span>
              <span className="text-foreground-neutral-subtle">
                {role.from === 'project'
                  ? `${role.providers.map(providerLabel).join(' or ')}, from the project`
                  : role.providers.map(providerLabel).join(', ')}
                {role.optional ? ' (optional)' : ''}
              </span>
              {role.tradeoff ? (
                <span className="text-xs text-foreground-neutral-muted">{role.tradeoff}</span>
              ) : null}
            </Row>
          ))}
          {metadata.choices.options.map((option) => (
            <Row key={option.id}>
              <span className="font-medium text-foreground-neutral-base">
                {option.question ?? option.id}
              </span>
              <ul className="flex flex-col gap-tight">
                {option.choices.map((choice) => (
                  <li key={choice.id} className="flex flex-col">
                    <span className="text-foreground-neutral-base">
                      {choice.label ?? choice.id}
                      {choice.default ? (
                        <span className="text-foreground-neutral-muted"> (default)</span>
                      ) : null}
                    </span>
                    {choice.tradeoff ? (
                      <span className="text-xs text-foreground-neutral-muted">
                        {choice.tradeoff}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Row>
          ))}
        </RowList>
      </Section>

      {slots.length + secrets.length + variables.length > 0 ? (
        <Section title="What you provide">
          <RowList>
            {slots.map((slot) => (
              <Row key={`slot:${slot.id}`}>
                <CodeName>{slot.id}</CodeName>
                <span className="text-foreground-neutral-subtle">{slot.description}</span>
              </Row>
            ))}
            {secrets.map((secret) => (
              <Row key={`secret:${secret.name}`}>
                <span className="flex items-center gap-inline">
                  <CodeName>{secret.name}</CodeName>
                  <span className="text-xs text-foreground-neutral-muted">secret</span>
                </span>
                <span className="text-foreground-neutral-subtle">{secret.description}</span>
              </Row>
            ))}
            {variables.map((variable) => (
              <Row key={`variable:${variable.name}`}>
                <span className="flex items-center gap-inline">
                  <CodeName>{variable.name}</CodeName>
                  <span className="text-xs text-foreground-neutral-muted">variable</span>
                </span>
                <span className="text-foreground-neutral-subtle">{variable.description}</span>
              </Row>
            ))}
          </RowList>
        </Section>
      ) : null}

      {actions.length > 0 ? (
        <Section title="Actions used">
          <RowList>
            {actions.map((reference) => (
              <Row key={reference}>
                <Link
                  href={packagePath(reference.slice(0, reference.lastIndexOf('@')))}
                  className="font-code text-foreground-highlight-interactive underline underline-offset-2"
                >
                  {reference}
                </Link>
              </Row>
            ))}
          </RowList>
        </Section>
      ) : null}
    </>
  );
}

function Flow({steps}: {steps: WorkflowTemplateFlowStep[]}) {
  return (
    <ol className="flex flex-col">
      {steps.map((step, index) => {
        const Icon = FLOW_ICONS[step.kind];
        const loopsTo = step.loops_to === undefined ? undefined : steps[step.loops_to];
        return (
          <li key={step.title} className="relative flex gap-group pb-group last:pb-0">
            {index === steps.length - 1 ? null : (
              <span
                aria-hidden="true"
                className="absolute top-36 bottom-0 left-[17px] w-px bg-border-neutral-base"
              />
            )}
            <span className="relative flex size-36 shrink-0 items-center justify-center rounded-full border border-border-neutral-base bg-background-neutral-base text-foreground-neutral-base">
              {step.provider ? (
                <ProviderIcon provider={step.provider} className="size-16" />
              ) : (
                <Icon aria-hidden="true" className="size-16" />
              )}
            </span>
            <span className="flex min-w-0 flex-col gap-tight pt-6">
              <span className="flex items-center gap-inline text-sm font-medium text-foreground-neutral-base">
                {step.title}
                <span className="font-code text-xs font-normal text-foreground-neutral-muted">
                  {step.kind}
                </span>
              </span>
              <span className="text-sm text-foreground-neutral-subtle">{step.detail}</span>
              {loopsTo ? (
                <span className="inline-flex items-center gap-tight text-xs text-foreground-neutral-subtle">
                  <CornerLeftUp aria-hidden="true" className="size-14" />
                  If this step fails, the workflow goes back to “{loopsTo.title}”
                </span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// A write without a provider depends on the reader's choices, so it forms one unlabeled row.
function groupWrites(writes: WorkflowTemplateWrite[]) {
  const groups = new Map<string | undefined, string[]>();
  for (const write of writes) {
    groups.set(write.provider, [...(groups.get(write.provider) ?? []), write.action]);
  }
  return [...groups.entries()];
}
