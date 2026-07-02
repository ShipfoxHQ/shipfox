import type {IntegrationConnectionDto} from '@shipfox/api-integration-core-dto';
import {Label} from '@shipfox/react-ui/label';
import {RadioGroup, RadioGroupItem} from '@shipfox/react-ui/radio-group';
import {Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui/tooltip';
import {Text} from '@shipfox/react-ui/typography';
import {useId} from 'react';
import {IntegrationIcon} from '#integration-icon.js';

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
      <Label id={labelId} className="sr-only">
        Source integration
      </Label>
      <RadioGroup
        aria-labelledby={labelId}
        value={selectedConnectionId ?? ''}
        onValueChange={onSelect}
        className="grid grid-cols-2 gap-8 min-[1200px]:grid-cols-3 max-[760px]:grid-cols-1"
      >
        {connections.map((connection) => (
          <RadioGroupItem key={connection.id} value={connection.id} className="p-12">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex min-w-0 items-center gap-10">
                  <IntegrationIcon
                    source={connection.provider}
                    aria-hidden
                    className="size-20 shrink-0 text-foreground-neutral-base"
                  />
                  <Text as="span" size="sm" bold className="truncate">
                    {connection.display_name}
                  </Text>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {connection.provider} · {connection.external_account_id}
              </TooltipContent>
            </Tooltip>
          </RadioGroupItem>
        ))}
      </RadioGroup>
    </div>
  );
}
