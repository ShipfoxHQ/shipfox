import type {ReactNode} from 'react';
import {AccessBadge, Chip, SensitiveChip} from '@/app/components/tool-reference/access-badge';
import {CodePanel} from '@/app/components/tool-reference/code-panel';
import {InlineCodeList} from '@/app/components/tool-reference/inline-code-list';
import {ParameterList} from '@/app/components/tool-reference/parameter-list';
import type {
  ToolReferenceDocument,
  ToolReferenceMethod,
  ToolReferenceTool,
} from '@/lib/tool-reference/document';

type Metadata = Pick<
  ToolReferenceTool,
  'access' | 'sensitive' | 'permissions' | 'alternativePermissions' | 'repository'
>;

export function ToolOperation({
  tool,
  document,
}: {
  tool: ToolReferenceTool;
  document: ToolReferenceDocument;
}) {
  return (
    <section
      className="@container flex scroll-mt-24 flex-col gap-y-group border-fd-border border-b py-frame last:border-b-0"
      id={tool.anchor}
    >
      <header className="flex flex-col gap-y-inline">
        <div className="flex items-center gap-x-cluster">
          <AccessBadge access={tool.access} />
          <a className="no-underline" href={`#${tool.anchor}`}>
            <code className="font-mono text-lg font-bold text-fd-foreground">{tool.id}</code>
          </a>
        </div>
        <p className="max-w-[70ch] text-fd-foreground">{tool.description}</p>
        <MetadataChips metadata={tool} />
      </header>

      <div className="grid grid-cols-1 items-start gap-section @min-[56rem]:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)]">
        <div className="flex flex-col gap-y-group">
          <Block title="Parameters">
            <InputFields tool={tool} document={document} />
          </Block>
          {tool.methods ? (
            <Block title="Methods">
              <div className="flex flex-col">
                {tool.methods.map((method) => (
                  <MethodRow key={method.id} method={method} />
                ))}
              </div>
            </Block>
          ) : null}
          {tool.output ? (
            <Block title={document.outputLabel === 'Result' ? 'Result' : 'Returns'}>
              {tool.output.length > 0 ? (
                <ParameterList fields={tool.output} />
              ) : (
                <Note>{emptyOutputText(document.kind)}</Note>
              )}
            </Block>
          ) : null}
        </div>
        <aside className="-order-1 @min-[56rem]:sticky @min-[56rem]:top-[calc(var(--fd-docs-row-1,3.5rem)+1rem)] @min-[56rem]:order-none">
          <CodePanel examples={tool.examples} />
        </aside>
      </div>
    </section>
  );
}

function InputFields({tool, document}: {tool: ToolReferenceTool; document: ToolReferenceDocument}) {
  if (tool.inputVariants) {
    return (
      <div className="flex flex-col gap-y-group">
        <Note>Exactly one of these shapes applies.</Note>
        {tool.inputVariants.map((variant) => (
          <div className="flex flex-col gap-y-tight" key={variant.title}>
            <p className="text-xs font-medium text-fd-foreground">
              Shape requiring <InlineCodeList markdown={variant.title} />
            </p>
            <ParameterList fields={variant.fields} />
          </div>
        ))}
      </div>
    );
  }
  if (tool.input.length === 0) {
    return (
      <Note>
        {document.kind === 'integration'
          ? 'This tool accepts an object with provider-defined fields.'
          : 'This tool takes no input.'}
      </Note>
    );
  }
  return (
    <div className="flex flex-col gap-y-tight">
      {tool.inputAlternatives ? (
        <Note>
          At least one of these input combinations is required:{' '}
          {tool.inputAlternatives.map((fields, index) => (
            <span key={fields.join('+')}>
              {index > 0 ? '; ' : ''}
              {fields.map((field, fieldIndex) => (
                <span key={field}>
                  {fieldIndex > 0 ? ' and ' : ''}
                  <code className="font-mono">{field}</code>
                </span>
              ))}
            </span>
          ))}
          .
        </Note>
      ) : null}
      <ParameterList fields={tool.input} />
    </div>
  );
}

function MethodRow({method}: {method: ToolReferenceMethod}) {
  return (
    <div
      className="flex scroll-mt-24 flex-col gap-y-tight border-fd-border border-b py-row last:border-b-0"
      id={method.anchor}
    >
      <div className="flex flex-wrap items-center gap-x-inline">
        <AccessBadge access={method.access} compact />
        <a className="no-underline" href={`#${method.anchor}`}>
          <code className="font-mono text-sm font-bold text-fd-foreground">{method.id}</code>
        </a>
      </div>
      <p className="text-sm text-fd-muted-foreground">{method.description}</p>
      <MetadataChips metadata={method} compact />
      <p className="text-xs text-fd-muted-foreground">
        {method.requiredInput.length > 0 ? (
          <>
            Required input:{' '}
            {method.requiredInput.map((field, index) => (
              <span key={field}>
                {index > 0 ? ', ' : ''}
                <code className="font-mono text-fd-foreground">{field}</code>
              </span>
            ))}
          </>
        ) : (
          'No additional required input.'
        )}
      </p>
    </div>
  );
}

function MetadataChips({metadata, compact = false}: {metadata: Metadata; compact?: boolean}) {
  const chips: ReactNode[] = [];
  if (metadata.permissions.length > 0) {
    chips.push(
      <Chip key="permissions" label="Requires">
        {metadata.permissions.map((permission, index) => (
          <span key={permission}>
            {index > 0 ? ', ' : ''}
            <code className="font-mono text-fd-foreground">{permission}</code>
          </span>
        ))}
      </Chip>,
    );
  }
  for (const alternative of metadata.alternativePermissions ?? []) {
    chips.push(
      <Chip key={`alternative-${alternative.join(',')}`} label="Or">
        {alternative.map((permission, index) => (
          <span key={permission}>
            {index > 0 ? ', ' : ''}
            <code className="font-mono text-fd-foreground">{permission}</code>
          </span>
        ))}
      </Chip>,
    );
  }
  if (metadata.sensitive) chips.push(<SensitiveChip key="sensitive" />);
  if (chips.length === 0 && !metadata.repository) return null;
  return (
    <div className={`flex flex-col ${compact ? 'gap-y-tight' : 'gap-y-inline'}`}>
      {chips.length > 0 ? <div className="flex flex-wrap gap-inline">{chips}</div> : null}
      {metadata.repository ? (
        <p className="text-xs text-fd-muted-foreground">
          <span className="font-medium text-fd-foreground">Repository:</span>{' '}
          <InlineCodeList markdown={metadata.repository.classification} />
        </p>
      ) : null}
      {metadata.repository?.indirectTargetNote ? (
        <p className="text-xs text-fd-muted-foreground">
          <span className="font-medium text-fd-foreground">Indirect target:</span>{' '}
          {metadata.repository.indirectTargetNote}
        </p>
      ) : null}
    </div>
  );
}

export function emptyOutputText(kind: ToolReferenceDocument['kind']): string {
  return kind === 'integration'
    ? 'This tool returns the provider response without declared fields.'
    : 'This tool returns an empty result.';
}

export function Block({title, children}: {title: string; children: ReactNode}) {
  return (
    <div className="flex flex-col gap-y-inline">
      <h4 className="border-fd-border border-b pb-inline text-xs font-medium uppercase tracking-wider text-fd-muted-foreground">
        {title}
      </h4>
      {children}
    </div>
  );
}

export function Note({children}: {children: ReactNode}) {
  return <p className="text-sm text-fd-muted-foreground">{children}</p>;
}
