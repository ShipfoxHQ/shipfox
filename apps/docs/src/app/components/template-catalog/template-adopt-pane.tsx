'use client';

import {Check, Copy} from 'lucide-react';
import {type ReactNode, useMemo, useState} from 'react';
import {buildTemplatePagePrompt} from '@/lib/template-catalog/prompt';
import {type TemplateRole, templateIconLabels} from '@/lib/template-catalog/types';
import {TemplateIcon} from './template-icon';

interface Variant {
  bindings: Record<string, string>;
  code: ReactNode;
}

export function TemplateAdoptPane({
  templateId,
  roles,
  variants,
}: {
  templateId: string;
  roles: TemplateRole[];
  variants: Variant[];
}) {
  const choosable = roles.filter((role) => role.optional || role.providers.length > 1);
  const [bindings, setBindings] = useState<Record<string, string | undefined>>(
    () => variants[variants.length - 1]?.bindings ?? {},
  );
  const [copied, setCopied] = useState(false);
  const variant =
    variants.find((candidate) =>
      roles.every((role) => candidate.bindings[role.role] === bindings[role.role]),
    ) ?? variants[0];
  const prompt = useMemo(
    () => buildTemplatePagePrompt(templateId, roles, bindings),
    [templateId, roles, bindings],
  );

  return (
    <div className="flex flex-col gap-group">
      <div
        id="use"
        className="flex scroll-mt-24 flex-col gap-group rounded-lg border border-fd-border bg-fd-card p-panel-compact"
      >
        <div className="flex flex-col gap-tight">
          <p className="text-sm font-semibold text-fd-foreground">Set up this workflow</p>
          <p className="text-xs text-fd-muted-foreground">
            Open your coding agent in your repository and paste this prompt. The agent needs the{' '}
            <a href="/how-to/set-up-work/connect-mcp-client" className="underline">
              Shipfox MCP server
            </a>
            .
          </p>
        </div>

        {choosable.map((role) => (
          <div key={role.role} className="flex flex-col gap-tight">
            <p className="text-xs font-medium text-fd-muted-foreground">
              {role.optional ? (role.question ?? role.role) : capitalize(role.role)}
            </p>
            <div className="flex flex-wrap gap-tight">
              {role.optional ? (
                <Pill
                  selected={bindings[role.role] === undefined}
                  onClick={() => setBindings((current) => ({...current, [role.role]: undefined}))}
                >
                  No
                </Pill>
              ) : null}
              {role.providers.map((provider) => (
                <Pill
                  key={provider}
                  selected={bindings[role.role] === provider}
                  onClick={() => setBindings((current) => ({...current, [role.role]: provider}))}
                >
                  <TemplateIcon icon={provider} className="size-3.5" />
                  {role.optional
                    ? `Yes, ${templateIconLabels[provider]}`
                    : templateIconLabels[provider]}
                </Pill>
              ))}
            </div>
          </div>
        ))}

        <div className="flex items-start gap-inline rounded-md border border-fd-border bg-fd-muted/60 px-row py-row">
          <p className="min-w-0 flex-1 font-mono text-xs leading-relaxed text-fd-foreground">
            {prompt}
          </p>
          <button
            type="button"
            aria-label="Copy prompt"
            onClick={() => {
              navigator.clipboard.writeText(prompt).then(
                () => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                },
                () => setCopied(false),
              );
            }}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-foreground"
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          </button>
        </div>
      </div>

      <div className="[&_figure]:my-0 [&_pre]:max-h-[28rem]">{variant?.code}</div>
    </div>
  );
}

function Pill({
  selected = false,
  onClick,
  children,
}: {
  selected?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`inline-flex min-h-8 items-center gap-tight rounded-md border px-row text-xs font-medium ${pillStyle(selected)}`}
    >
      {children}
    </button>
  );
}

function pillStyle(selected: boolean) {
  if (selected) return 'border-fd-primary bg-fd-primary/10 text-fd-foreground';
  return 'border-fd-border text-fd-muted-foreground hover:text-fd-foreground';
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
