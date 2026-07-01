import {Button, Code, cn, Text, toast, useCopyToClipboard} from '@shipfox/react-ui';
import type {ReactNode} from 'react';
import {useEffect, useRef, useState} from 'react';

interface CopyableValueProps {
  label: string;
  value: string;
  note?: ReactNode;
  className?: string;
}

export function CopyableValue({label, value, note, className}: CopyableValueProps) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const {copy} = useCopyToClipboard({
    text: value,
    onCopy: () => {
      setCopied(true);
      toast.success('Copied.');
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
      toast.error('Could not copy.');
    }
  }

  return (
    <div className={cn('flex w-full min-w-0 flex-col gap-8', className)}>
      <div className="flex min-w-0 items-center gap-8">
        <Code
          as="span"
          variant="paragraph"
          className="min-w-0 flex-1 truncate rounded-4 border border-border-neutral-base bg-background-components-base px-8 py-6 text-foreground-neutral-base"
        >
          {value}
        </Code>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          iconLeft={copied ? 'check' : 'copy'}
          aria-label={`Copy ${label}`}
          onClick={() => {
            void handleCopy();
          }}
        >
          Copy
        </Button>
      </div>
      {note ? (
        <Text size="sm" className="text-foreground-neutral-muted">
          {note}
        </Text>
      ) : null}
    </div>
  );
}
