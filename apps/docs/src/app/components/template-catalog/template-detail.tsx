import {highlight} from 'fumadocs-core/highlight';
import {CodeBlock, Pre} from 'fumadocs-ui/components/codeblock';
import {
  ArrowRight,
  Bot,
  ChevronRight,
  CircleCheck,
  CornerLeftUp,
  type LucideIcon,
  PenLine,
  UserRound,
  Wrench,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import type {ReactNode} from 'react';
import {getTemplateDetail} from '@/lib/template-catalog/source';
import {
  type TemplateFlowKind,
  type TemplateFlowStep,
  type TemplateIcon as TemplateIconName,
  type TemplateWrite,
  templateIconLabels,
} from '@/lib/template-catalog/types';
import {TemplateAdoptPane} from './template-adopt-pane';
import {RoleIcons} from './template-gallery';
import {TemplateIcon} from './template-icon';

const kindIcons: Record<TemplateFlowKind, LucideIcon> = {
  trigger: Zap,
  agent: Bot,
  check: CircleCheck,
  tool: Wrench,
  write: PenLine,
  human: UserRound,
};

export async function TemplateDetail({id}: {id: string}) {
  const template = getTemplateDetail(id);
  const variants = await Promise.all(
    template.variants.map(async (variant) => ({
      bindings: variant.bindings,
      code: (
        <CodeBlock title={`.shipfox/workflows/${template.id}.yml`} className="my-0">
          {await highlight(variant.yaml, {lang: 'yaml', components: {pre: Pre}})}
        </CodeBlock>
      ),
    })),
  );

  return (
    <div className="not-prose grid gap-region xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <div className="flex min-w-0 flex-col gap-region">
        <div className="flex flex-wrap items-center gap-x-section gap-y-inline text-sm text-fd-muted-foreground">
          <RoleIcons template={template} />
          <span className="inline-flex items-center gap-tight">
            <Zap aria-hidden="true" className="size-4" />
            {template.starts}
          </span>
        </div>

        <Section title="How it works">
          <Flow steps={template.flow} />
        </Section>

        <Section title="What it writes">
          <ul className="flex flex-col divide-y divide-fd-border rounded-lg border border-fd-border">
            {groupWrites(template.writes).map(([provider, actions]) => (
              <li
                key={provider ?? 'setup'}
                className="flex items-center gap-cluster px-row py-row text-sm"
              >
                {provider === undefined ? null : (
                  <>
                    <TemplateIcon icon={provider} className="size-4 text-fd-muted-foreground" />
                    <span className="w-16 shrink-0 font-medium text-fd-foreground">
                      {templateIconLabels[provider]}
                    </span>
                  </>
                )}
                <ul className="flex flex-col gap-tight text-fd-muted-foreground">
                  {actions.map((action) => (
                    <li key={action}>{action}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Section>

        {template.prerequisites.length > 0 ? (
          <Section title="Before you start">
            <ul className="flex list-inside list-disc flex-col gap-inline text-sm text-fd-foreground marker:text-fd-muted-foreground">
              {template.prerequisites.map((item) => (
                <li key={item}>{inlineCode(item)}</li>
              ))}
            </ul>
          </Section>
        ) : null}

        {template.options.length > 0 ? (
          <Section title="Choices you make">
            <p className="text-sm text-fd-muted-foreground">
              When you set up this workflow, your coding agent asks you these questions. The
              workflow file on this page uses the default answers.
            </p>
            <ul className="flex flex-col divide-y divide-fd-border rounded-lg border border-fd-border">
              {template.options.map((option) => {
                const fallback =
                  option.choices.find((choice) => choice.default) ?? option.choices[0];
                const others = option.choices.length - 1;
                return (
                  <li key={option.id}>
                    <details className="group">
                      <summary className="flex cursor-pointer list-none items-start gap-cluster px-row py-row [&::-webkit-details-marker]:hidden">
                        <ChevronRight
                          aria-hidden="true"
                          className="size-4 shrink-0 text-fd-muted-foreground transition-transform group-open:rotate-90"
                        />
                        <span className="flex min-w-0 flex-1 flex-col gap-tight">
                          <span className="text-sm font-medium text-fd-foreground">
                            {option.question ?? option.id}
                          </span>
                          <span className="text-xs text-fd-muted-foreground">
                            Default:{' '}
                            <span className="text-fd-foreground">
                              {fallback?.label ?? fallback?.id}
                            </span>
                          </span>
                        </span>
                        {others > 0 ? (
                          <span className="shrink-0 text-xs text-fd-muted-foreground">
                            {others} other {others === 1 ? 'choice' : 'choices'}
                          </span>
                        ) : null}
                      </summary>
                      <ul className="flex flex-col gap-group px-row pb-inline">
                        {option.choices.map((choice) => (
                          <li key={choice.id} className="flex flex-col gap-tight">
                            <span className="flex items-center gap-inline text-sm font-medium text-fd-foreground">
                              {choice.label ?? choice.id}
                              {choice.id === fallback?.id ? (
                                <span className="rounded bg-fd-primary/15 px-tight text-[10px] font-semibold uppercase tracking-wide text-fd-primary">
                                  Default
                                </span>
                              ) : null}
                            </span>
                            {choice.tradeoff ? (
                              <span className="text-xs leading-relaxed text-fd-muted-foreground">
                                {choice.tradeoff}
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </li>
                );
              })}
            </ul>
          </Section>
        ) : null}

        {template.models.length > 0 ? (
          <Section title="Models">
            <ul className="flex flex-col divide-y divide-fd-border rounded-lg border border-fd-border">
              {template.models.map((model) => (
                <li key={model.key} className="flex flex-col gap-tight px-row py-row text-sm">
                  <span className="flex flex-wrap items-baseline gap-inline">
                    <code className="text-fd-foreground">{model.key}</code>
                    {model.model ? (
                      <span className="text-xs text-fd-muted-foreground">
                        tested with {model.model}
                        {model.thinking ? ` · ${model.thinking} thinking` : ''}
                      </span>
                    ) : null}
                  </span>
                  {model.note ? (
                    <span className="text-fd-muted-foreground">{model.note}</span>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="text-xs text-fd-muted-foreground">
              When you set up this workflow, your coding agent suggests models that your workspace
              can use. You choose the model for each step.
            </p>
          </Section>
        ) : null}

        {template.related.length > 0 ? (
          <Section title="Related examples">
            <ul className="grid gap-inline sm:grid-cols-2">
              {template.related.map((related) => (
                <li key={related.id}>
                  <Link
                    href={related.href}
                    className="flex items-center justify-between gap-inline rounded-md border border-fd-border px-row py-row text-sm font-medium text-fd-foreground hover:bg-fd-accent/40"
                  >
                    {related.title}
                    <ArrowRight
                      aria-hidden="true"
                      className="size-4 shrink-0 text-fd-muted-foreground"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
      </div>

      <aside className="min-w-0 xl:sticky xl:top-24 xl:self-start">
        <TemplateAdoptPane templateId={template.id} roles={template.roles} variants={variants} />
      </aside>
    </div>
  );
}

// A write without a provider depends on the reader's choices, so it forms one unlabelled row.
function groupWrites(writes: TemplateWrite[]) {
  const groups = new Map<TemplateIconName | undefined, string[]>();
  for (const write of writes)
    groups.set(write.provider, [...(groups.get(write.provider) ?? []), write.action]);
  return [...groups.entries()];
}

function Section({title, children}: {title: string; children: ReactNode}) {
  return (
    <section className="flex flex-col gap-group">
      <h2 className="text-lg font-semibold text-fd-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Flow({steps}: {steps: TemplateFlowStep[]}) {
  return (
    <ol className="relative flex flex-col">
      {steps.map((step, index) => {
        const Icon = kindIcons[step.kind];
        const last = index === steps.length - 1;
        return (
          <li key={step.title} className="relative flex gap-group pb-group last:pb-0">
            {last ? null : (
              <span
                aria-hidden="true"
                className="absolute top-9 bottom-0 left-[17px] w-px bg-fd-border"
              />
            )}
            <span
              className={`relative z-10 flex size-9 shrink-0 items-center justify-center rounded-full border ${flowNodeStyles[step.kind]}`}
            >
              {step.provider ? (
                <TemplateIcon icon={step.provider} className="size-4" />
              ) : (
                <Icon aria-hidden="true" className="size-4" />
              )}
            </span>
            <span className="flex min-w-0 flex-col gap-tight">
              <span className="flex items-center gap-inline text-sm font-medium text-fd-foreground">
                {step.title}
                <span className="text-[10px] font-medium uppercase tracking-wide text-fd-muted-foreground">
                  {step.kind}
                </span>
              </span>
              <span className="text-sm text-fd-muted-foreground">{step.detail}</span>
              {step.loopsTo !== undefined ? (
                <span className="inline-flex items-center gap-tight text-xs text-fd-primary">
                  <CornerLeftUp aria-hidden="true" className="size-3.5" />
                  If this step fails, the workflow goes back to “{steps[step.loopsTo]?.title}”
                </span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const inlineCodePattern = /(`[^`]+`)/;

const defaultNodeStyle = 'border-fd-border bg-fd-card text-fd-foreground';
const flowNodeStyles: Record<TemplateFlowKind, string> = {
  trigger: 'border-fd-primary/50 bg-fd-primary/10 text-fd-primary',
  agent: defaultNodeStyle,
  check: defaultNodeStyle,
  tool: defaultNodeStyle,
  write: defaultNodeStyle,
  human: 'border-dashed border-fd-border bg-fd-background text-fd-muted-foreground',
};

function inlineCode(text: string): ReactNode[] {
  return text.split(inlineCodePattern).map((part, index) =>
    part.startsWith('`') ? (
      <code key={index} className="rounded bg-fd-muted px-tight text-[0.85em]">
        {part.slice(1, -1)}
      </code>
    ) : (
      part
    ),
  );
}
