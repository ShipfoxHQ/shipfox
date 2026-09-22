import type {ReactNode} from 'react';
import type {ToolAccess} from '@/lib/tool-reference/document';

const accessClassName: Record<ToolAccess, string> = {
  read: 'border-fd-border bg-fd-muted text-fd-muted-foreground',
  write: 'border-fd-primary/20 bg-fd-primary/10 text-fd-primary',
};

export function AccessBadge({access, compact = false}: {access: ToolAccess; compact?: boolean}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded border font-mono font-medium uppercase tracking-wide ${accessClassName[access]} ${compact ? 'h-4 px-tight text-[9px]' : 'h-5 px-tight text-[11px]'}`}
    >
      {access}
    </span>
  );
}

export function Chip({label, children}: {label?: string; children: ReactNode}) {
  return (
    <span className="inline-flex h-6 items-center gap-x-tight rounded border border-fd-border bg-fd-card px-tight text-xs text-fd-muted-foreground">
      {label ? <span>{label}</span> : null}
      {children}
    </span>
  );
}

export function SensitiveChip() {
  return (
    <span className="inline-flex h-6 items-center rounded border border-rose-500/20 bg-rose-500/10 px-tight text-xs font-medium text-rose-700 dark:text-rose-300">
      Sensitive
    </span>
  );
}
