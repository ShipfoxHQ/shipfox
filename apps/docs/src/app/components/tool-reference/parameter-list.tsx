import {ChevronRight} from 'lucide-react';
import type {ToolReferenceField} from '@/lib/tool-reference/document';

const requirementLabel = {
  required: {text: 'Required', className: 'text-fd-primary'},
  conditional: {text: 'Conditional', className: 'text-amber-700 dark:text-amber-400'},
} as const;

export function ParameterList({
  fields,
  badges,
}: {
  fields: ToolReferenceField[];
  /** Labels shown next to top-level fields, keyed by field name. */
  badges?: Readonly<Record<string, string>>;
}) {
  return (
    <div className="flex flex-col">
      {fields.map((field) => (
        <ParameterRow badge={badges?.[field.name]} field={field} key={field.path} />
      ))}
    </div>
  );
}

function ParameterRow({field, badge}: {field: ToolReferenceField; badge?: string}) {
  const requirement =
    field.requirement === 'optional' ? undefined : requirementLabel[field.requirement];
  return (
    <div className="flex flex-col gap-y-tight border-fd-border border-b py-row last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-x-inline">
        <code className="font-mono text-sm font-bold text-fd-foreground">{field.name}</code>
        <span className="font-mono text-xs text-fd-muted-foreground">{field.type}</span>
        {requirement ? (
          <span
            className={`text-[11px] font-medium uppercase tracking-wide ${requirement.className}`}
          >
            {requirement.text}
          </span>
        ) : null}
        {badge ? (
          <span className="inline-flex h-5 items-center rounded border border-fd-primary/20 bg-fd-primary/10 px-tight text-[11px] font-medium text-fd-primary">
            {badge}
          </span>
        ) : null}
      </div>
      {field.description ? (
        <p className="text-sm text-fd-muted-foreground">{field.description}</p>
      ) : null}
      {field.enumValues ? (
        <p className="text-xs text-fd-muted-foreground">
          Possible values:{' '}
          {field.enumValues.map((value, index) => (
            <span key={value}>
              {index > 0 ? ', ' : ''}
              <code className="rounded bg-fd-muted px-tight font-mono text-fd-foreground">
                {value}
              </code>
            </span>
          ))}
        </p>
      ) : null}
      {field.constraints ? (
        <p className="text-xs text-fd-muted-foreground">{field.constraints}</p>
      ) : null}
      {field.children ? <NestedFields fields={field.children} /> : null}
    </div>
  );
}

function NestedFields({fields}: {fields: ToolReferenceField[]}) {
  const label = `${fields.length} ${fields.length === 1 ? 'attribute' : 'attributes'}`;
  return (
    <details className="group rounded-lg border border-fd-border bg-fd-card">
      <summary className="flex cursor-pointer select-none items-center gap-x-inline p-tight text-xs text-fd-muted-foreground group-open:border-fd-border group-open:border-b [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
        <span className="group-open:hidden">Show {label}</span>
        <span className="hidden group-open:inline">Hide {label}</span>
      </summary>
      <div className="px-row">
        <ParameterList fields={fields} />
      </div>
    </details>
  );
}
