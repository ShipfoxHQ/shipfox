import {Badge} from '@shipfox/react-ui/badge';
import {Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui/tooltip';
import type {ModelLock} from '#core/models.js';

export function ModelLockBadge({lock}: {lock: ModelLock}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="warning" tabIndex={0}>
          {lock.label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{lock.message}</TooltipContent>
    </Tooltip>
  );
}
