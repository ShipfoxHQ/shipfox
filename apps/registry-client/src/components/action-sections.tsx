import type {ActionDetails} from '@/lib/package-page';
import {providerLabel} from '@/lib/providers';
import {ProviderIcon} from './provider-icon';
import {CodeName, Row, RowList, Section} from './section';

export function ActionSections({details}: {details: ActionDetails}) {
  const {capabilities, interface: contract} = details.metadata;
  const aliases = Object.entries(capabilities);
  const inputs = Object.entries(contract.inputs);
  const outputs = Object.entries(contract.outputs);
  return (
    <>
      <Section title="Integrations it uses">
        {aliases.length === 0 ? (
          <p className="text-sm text-foreground-neutral-subtle">
            This action calls no integration.
          </p>
        ) : (
          <RowList>
            {aliases.map(([alias, capability]) => (
              <Row key={alias}>
                <span className="flex items-center gap-inline">
                  <ProviderIcon provider={capability.provider} className="size-16" />
                  <span className="font-medium text-foreground-neutral-base">
                    {providerLabel(capability.provider)}
                  </span>
                  <span className="text-foreground-neutral-muted">as</span>
                  <CodeName>{alias}</CodeName>
                </span>
                <span className="text-foreground-neutral-subtle">
                  {capability.allow_write
                    ? 'Can read and change data.'
                    : 'Read-only. It cannot call tools that change data.'}
                </span>
                {capability.selectors.length > 0 ? (
                  <span className="font-code text-xs text-foreground-neutral-muted">
                    {capability.selectors.join(', ')}
                  </span>
                ) : null}
              </Row>
            ))}
          </RowList>
        )}
      </Section>

      {inputs.length > 0 ? (
        <Section title="Inputs">
          <RowList>
            {inputs.map(([name, input]) => (
              <Row key={name}>
                <Signature name={name} type={input.type} required={input.required} />
                {input.description ? (
                  <span className="text-foreground-neutral-subtle">{input.description}</span>
                ) : null}
                {input.default === undefined ? null : (
                  <span className="text-xs text-foreground-neutral-muted">
                    Default: <code className="font-code">{JSON.stringify(input.default)}</code>
                  </span>
                )}
              </Row>
            ))}
          </RowList>
        </Section>
      ) : null}

      {outputs.length > 0 ? (
        <Section title="Outputs">
          <RowList>
            {outputs.map(([name, output]) => (
              <Row key={name}>
                <Signature name={name} type={output.type} required={output.required} />
                {output.description ? (
                  <span className="text-foreground-neutral-subtle">{output.description}</span>
                ) : null}
              </Row>
            ))}
          </RowList>
        </Section>
      ) : null}

      {details.dependencies.length > 0 ? (
        <Section title="Bundled dependencies">
          <RowList>
            {details.dependencies.map((dependency) => (
              <Row key={`${dependency.name}@${dependency.version}`}>
                <span className="font-code text-sm text-foreground-neutral-base">
                  {dependency.name}
                  <span className="text-foreground-neutral-muted">@{dependency.version}</span>
                </span>
              </Row>
            ))}
          </RowList>
        </Section>
      ) : null}
    </>
  );
}

function Signature({name, type, required}: {name: string; type: string; required: boolean}) {
  return (
    <span className="flex items-center gap-inline">
      <CodeName>{name}</CodeName>
      <span className="font-code text-xs text-foreground-neutral-muted">{type}</span>
      {required ? <span className="text-xs text-foreground-neutral-subtle">required</span> : null}
    </span>
  );
}
