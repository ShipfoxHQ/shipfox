import {Header} from '@shipfox/react-ui/typography';
import type {ReactNode} from 'react';

export function Section({title, children}: {title: string; children: ReactNode}) {
  return (
    <section className="flex min-w-0 flex-col gap-cluster">
      <Header variant="h3" as="h2" className="text-foreground-neutral-base">
        {title}
      </Header>
      {children}
    </section>
  );
}

/** A bordered list whose rows are divided by hairlines. */
export function RowList({children}: {children: ReactNode}) {
  return (
    <ul className="flex flex-col divide-y divide-border-neutral-base overflow-hidden rounded-8 border border-border-neutral-base bg-background-neutral-base">
      {children}
    </ul>
  );
}

export function Row({children}: {children: ReactNode}) {
  return <li className="flex min-w-0 flex-col gap-tight px-row py-row text-sm">{children}</li>;
}

export function CodeName({children}: {children: ReactNode}) {
  return <code className="font-code text-sm text-foreground-neutral-base">{children}</code>;
}

const INLINE_CODE = /(`[^`]+`)/;

/** Plain text with backtick spans set as code, the way manifests write command names. */
export function InlineCode({text}: {text: string}) {
  return text.split(INLINE_CODE).map((part, index) =>
    part.startsWith('`') && part.endsWith('`') && part.length > 1 ? (
      <code
        key={index}
        className="rounded-4 bg-background-components-base px-4 font-code text-[0.9em]"
      >
        {part.slice(1, -1)}
      </code>
    ) : (
      part
    ),
  );
}
