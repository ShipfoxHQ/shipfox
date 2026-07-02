import type {IntegrationConnectionDto} from '@shipfox/api-integration-core-dto';
import {Label} from '@shipfox/react-ui/label';
import {RadioGroup, RadioGroupItem} from '@shipfox/react-ui/radio-group';
import {Text} from '@shipfox/react-ui/typography';
import {useId} from 'react';

export function ConnectionPicker({
  connections,
  selectedConnectionId,
  onSelect,
}: {
  connections: IntegrationConnectionDto[];
  selectedConnectionId: string | undefined;
  onSelect: (connectionId: string) => void;
}) {
  const labelId = useId();

  return (
    <div className="flex flex-col gap-10">
      <Label id={labelId}>Source connection</Label>
      <RadioGroup
        aria-labelledby={labelId}
        value={selectedConnectionId ?? ''}
        onValueChange={onSelect}
      >
        {connections.map((connection) => (
          <RadioGroupItem key={connection.id} value={connection.id}>
            <Text size="sm" bold>
              {connection.display_name}
            </Text>
            <Text size="xs" className="text-foreground-neutral-muted">
              {connection.provider} · {connection.external_account_id}
            </Text>
          </RadioGroupItem>
        ))}
      </RadioGroup>
    </div>
  );
}
