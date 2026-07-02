import {Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui/tooltip';

export function TokenName({name}: {name: string}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="block w-full min-w-0 cursor-help truncate rounded-4 text-left text-sm leading-20 font-medium text-foreground-neutral-base outline-none focus-visible:shadow-button-neutral-focus"
        >
          {name}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <span className="block max-w-[360px] break-words">{name}</span>
      </TooltipContent>
    </Tooltip>
  );
}
