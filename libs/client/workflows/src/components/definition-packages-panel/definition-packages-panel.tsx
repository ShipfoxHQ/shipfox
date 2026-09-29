import {Badge} from '@shipfox/react-ui/badge';
import {Button} from '@shipfox/react-ui/button';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@shipfox/react-ui/collapsible';
import {useCopyToClipboard} from '@shipfox/react-ui/hooks';
import {Markdown} from '@shipfox/react-ui/markdown';
import {toast} from '@shipfox/react-ui/toast';
import {Code, Text} from '@shipfox/react-ui/typography';
import {useEffect, useId, useRef, useState} from 'react';
import {
  type PackageUpdate,
  packageUpdateChangesPermissions,
  packageUpdateNeedsInput,
} from '#core/package-updates.js';

const KIND_LABELS = {action: 'Action', template: 'Template'} as const;

export interface DefinitionPackagesPanelProps {
  updates: readonly PackageUpdate[];
}

/** The registry packages a definition pins, and the newer versions they have. */
export function DefinitionPackagesPanel({updates}: DefinitionPackagesPanelProps) {
  const titleId = useId();
  if (updates.length === 0) return null;

  return (
    <section aria-labelledby={titleId} className="flex w-full flex-col gap-inline">
      <Text id={titleId} size="sm" bold>
        Packages
      </Text>
      <ul className="flex flex-col divide-y divide-border-neutral-base rounded-8 border border-border-neutral-base">
        {updates.map((update) => (
          <PackageRow key={`${update.kind}:${update.package}`} update={update} />
        ))}
      </ul>
    </section>
  );
}

function PackageRow({update}: {update: PackageUpdate}) {
  const showChangelog = update.behind && update.changelog.length > 0;

  return (
    <li className="flex min-w-0 flex-col gap-tight p-panel-compact">
      <div className="flex min-w-0 flex-wrap items-baseline gap-tight">
        <Code variant="label" className="break-all">
          {update.package}
        </Code>
        <Text size="xs" className="text-foreground-neutral-muted">
          {KIND_LABELS[update.kind]}
        </Text>
      </div>
      <div className="flex flex-wrap items-center gap-tight">
        {update.behind ? (
          <Badge variant="info">
            Update available: {update.version} to {update.latest}
          </Badge>
        ) : (
          <Text size="xs" className="text-foreground-neutral-muted">
            {update.version}, the latest version
          </Text>
        )}
        {packageUpdateChangesPermissions(update) ? (
          <Badge variant="warning">Changes permissions</Badge>
        ) : null}
        {packageUpdateNeedsInput(update) ? <Badge variant="warning">Needs your input</Badge> : null}
      </div>
      {update.steps.length > 0 ? (
        <Text size="xs" className="break-words text-foreground-neutral-muted">
          Used in {update.steps.join(', ')}
        </Text>
      ) : null}
      {update.upgradePrompt ? (
        <UpgradePrompt prompt={update.upgradePrompt} subject={update.package} />
      ) : null}
      {showChangelog ? <Changelog update={update} /> : null}
    </li>
  );
}

function UpgradePrompt({prompt, subject}: {prompt: string; subject: string}) {
  return (
    <div className="flex items-start gap-tight rounded-6 border border-border-neutral-base bg-background-components-base p-tight">
      <Text size="sm" className="min-w-0 flex-1 break-words">
        {prompt}
      </Text>
      <CopyPromptButton prompt={prompt} subject={subject} />
    </div>
  );
}

function CopyPromptButton({prompt, subject}: {prompt: string; subject: string}) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const {copy} = useCopyToClipboard({
    text: prompt,
    onCopy: () => {
      setCopied(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopied(false), 2000);
    },
  });

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  async function handleCopy() {
    try {
      await copy();
    } catch {
      toast.error('Could not copy the prompt. Try again.');
    }
  }

  const label = `${copied ? 'Copied upgrade prompt' : 'Copy upgrade prompt'} for ${subject}`;
  return (
    <Button
      type="button"
      size="xs"
      variant="transparentMuted"
      className="shrink-0"
      iconLeft={copied ? 'check' : 'copy'}
      aria-label={label}
      title={label}
      onClick={() => void handleCopy()}
    />
  );
}

function Changelog({update}: {update: PackageUpdate}) {
  return (
    <Collapsible className="flex flex-col gap-tight">
      <CollapsibleTrigger asChild>
        <Button type="button" size="xs" variant="transparentMuted" className="self-start">
          Changelog
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col gap-inline">
          {update.changelog.map((entry) => (
            <div key={entry.version} className="flex min-w-0 flex-col gap-tight">
              <Code variant="label">{entry.version}</Code>
              <Markdown className="text-sm [&>*:last-child]:mb-0">{entry.markdown}</Markdown>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
