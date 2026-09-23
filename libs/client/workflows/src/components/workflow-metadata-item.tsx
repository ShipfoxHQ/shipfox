import {Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui/tooltip';
import {Text} from '@shipfox/react-ui/typography';
import {cn} from '@shipfox/react-ui/utils';
import type {ReactNode} from 'react';

export function WorkflowMetadataItem({
  icon,
  children,
  description,
  className,
}: {
  icon: ReactNode;
  children: ReactNode;
  description: string;
  className?: string | undefined;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={description}
          className={cn(
            'inline-flex min-w-0 max-w-full items-center gap-tight text-xs text-foreground-neutral-subtle',
            className,
          )}
        >
          <span aria-hidden="true" className="inline-flex size-12 shrink-0 items-center">
            {icon}
          </span>
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <Text as="span" size="xs" className="block max-w-[360px] break-words">
          {description}
        </Text>
      </TooltipContent>
    </Tooltip>
  );
}
