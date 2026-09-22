import Link from 'next/link';
import type {ReactNode} from 'react';
import type {FieldNode, WorkflowSchemaSection} from '@/lib/workflow-schema/document';

const KIND_LABELS: Record<NonNullable<WorkflowSchemaSection['kind']>, string> = {
  run: 'Run step',
  agent: 'Agent step',
  tool: 'Tool step',
  checkout: 'Checkout step',
};

// Field descriptions come from the JSON schema as Markdown with links and
// code spans only, so a small tokenizer covers them.
const INLINE_TOKEN_PATTERN = /(\[[^\]]+\]\([^)]*\)|`[^`]+`)/g;
const LINK_PATTERN = /^\[([^\]]+)\]\(([^)]*)\)$/;

export function FieldList({
  fields,
  kind,
}: {
  fields: FieldNode[];
  kind?: WorkflowSchemaSection['kind'];
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-fd-border bg-fd-card">
      {kind ? (
        <div className="border-b border-fd-border bg-fd-muted px-row py-[var(--pad-tight)]">
          <span className="inline-flex rounded bg-fd-primary/10 px-tight text-xs font-medium text-fd-primary">
            {KIND_LABELS[kind]}
          </span>
        </div>
      ) : null}
      <dl className="divide-y divide-fd-border">
        {fields.map((field) => (
          <Field key={field.name} field={field} />
        ))}
      </dl>
    </div>
  );
}

function Field({field}: {field: FieldNode}) {
  return (
    <div className="px-row py-row">
      <dt className="flex flex-wrap items-baseline gap-x-cluster gap-y-tight">
        <code className="font-mono text-sm text-fd-primary">{field.name}</code>
        <span className="font-mono text-[13px] text-fd-muted-foreground">
          {field.link ? (
            <Link
              href={field.link}
              className="text-fd-foreground underline decoration-fd-border underline-offset-4 hover:decoration-fd-primary"
            >
              {field.type}
            </Link>
          ) : (
            field.type
          )}
        </span>
        {field.requirement === 'required' ? (
          <span className="rounded bg-fd-primary/10 px-tight text-xs font-medium tracking-wide text-fd-primary uppercase">
            Required
          </span>
        ) : null}
        {field.default ? (
          <span className="ms-auto text-xs text-fd-muted-foreground">
            Default{' '}
            <code className="rounded bg-fd-secondary px-tight font-mono text-fd-foreground">
              {field.default}
            </code>
          </span>
        ) : null}
      </dt>
      <dd className="mt-[var(--space-tight)] text-sm text-fd-foreground">
        <p>
          <InlineMarkdown text={field.description} />
        </p>
        {field.enum ? (
          <ul className="mt-[var(--space-inline)] flex flex-wrap gap-tight">
            {field.enum.map((value) => (
              <li key={value}>
                <code className="rounded border border-fd-border bg-fd-secondary px-tight font-mono text-xs">
                  {value}
                </code>
              </li>
            ))}
          </ul>
        ) : null}
        {field.constraints ? (
          <p className="mt-[var(--space-tight)] text-xs text-fd-muted-foreground">
            <InlineMarkdown text={field.constraints} />
          </p>
        ) : null}
      </dd>
    </div>
  );
}

function InlineMarkdown({text}: {text: string}): ReactNode {
  return text
    .split(INLINE_TOKEN_PATTERN)
    .filter(Boolean)
    .map((part, index) => {
      const key = `${index}:${part}`;
      const link = LINK_PATTERN.exec(part);
      if (link?.[1] && link[2] !== undefined) {
        return (
          <InlineLink key={key} href={link[2]}>
            <InlineMarkdown text={link[1]} />
          </InlineLink>
        );
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return (
          <code key={key} className="rounded bg-fd-secondary px-tight font-mono text-[13px]">
            {part.slice(1, -1)}
          </code>
        );
      }
      return part;
    });
}

function InlineLink({href, children}: {href: string; children: ReactNode}) {
  const className = 'underline decoration-fd-primary underline-offset-4 hover:text-fd-primary';
  if (href.startsWith('/')) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} className={className}>
      {children}
    </a>
  );
}
