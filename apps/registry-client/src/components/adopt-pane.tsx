'use client';

import {cn} from '@shipfox/react-ui/utils/cn';
import {type ReactNode, useState} from 'react';
import {buildAdoptPrompt, isChoosable, type PromptRole} from '@/lib/prompts';
import {providerLabel} from '@/lib/providers';
import {CopyButton} from './copy-button';

interface AdoptRole extends PromptRole {
  question?: string;
}

export function AdoptPane({packageName, roles}: {packageName: string; roles: AdoptRole[]}) {
  // Every required role starts on its first provider, and every optional role is left out.
  const [bindings, setBindings] = useState<Record<string, string | undefined>>(() =>
    Object.fromEntries(
      roles.map((role) => [role.id, role.optional ? undefined : role.providers[0]]),
    ),
  );
  const prompt = buildAdoptPrompt({packageName, roles, bindings});
  const bind = (role: string, provider: string | undefined) =>
    setBindings((current) => ({...current, [role]: provider}));

  return (
    <div className="flex flex-col gap-group">
      {roles.filter(isChoosable).map((role) => (
        <div key={role.id} className="flex flex-col gap-tight">
          <p className="text-xs font-medium text-foreground-neutral-subtle">
            {role.optional ? (role.question ?? role.id) : capitalize(role.id)}
          </p>
          <div className="flex flex-wrap gap-tight">
            {role.optional ? (
              <Choice
                selected={bindings[role.id] === undefined}
                onSelect={() => bind(role.id, undefined)}
              >
                No
              </Choice>
            ) : null}
            {role.providers.map((provider) => (
              <Choice
                key={provider}
                selected={bindings[role.id] === provider}
                onSelect={() => bind(role.id, provider)}
              >
                {role.optional ? `Yes, ${providerLabel(provider)}` : providerLabel(provider)}
              </Choice>
            ))}
          </div>
        </div>
      ))}

      <div className="flex items-start gap-inline rounded-6 border border-border-neutral-base bg-background-subtle-base px-row py-row">
        <p className="min-w-0 flex-1 font-code text-xs leading-20 text-foreground-neutral-base">
          {prompt}
        </p>
        <CopyButton text={prompt} label="Copy prompt" />
      </div>
    </div>
  );
}

function Choice({
  selected,
  onSelect,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'inline-flex min-h-32 items-center rounded-6 border px-10 text-xs font-medium transition-colors focus-visible:shadow-focus-inset focus-visible:outline-none',
        selected
          ? 'border-border-highlights-interactive bg-background-highlight-base text-foreground-neutral-base'
          : 'border-border-neutral-base text-foreground-neutral-subtle hover:text-foreground-neutral-base',
      )}
    >
      {children}
    </button>
  );
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
