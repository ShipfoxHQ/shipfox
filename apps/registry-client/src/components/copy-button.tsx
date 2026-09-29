'use client';

import {copyTextToClipboard} from '@shipfox/react-ui/utils/clipboard';
import {Check, Copy} from 'lucide-react';
import {useState} from 'react';

export function CopyButton({text, label}: {text: string; label: string}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => {
        copyTextToClipboard(text).then(
          () => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          },
          () => setCopied(false),
        );
      }}
      className="inline-flex size-28 shrink-0 items-center justify-center rounded-6 text-foreground-neutral-muted transition-colors hover:bg-background-components-hover hover:text-foreground-neutral-base focus-visible:shadow-focus-inset focus-visible:outline-none"
    >
      {copied ? (
        <Check aria-hidden="true" className="size-16" />
      ) : (
        <Copy aria-hidden="true" className="size-16" />
      )}
    </button>
  );
}
