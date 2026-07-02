import {Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui/tooltip';

export function TokenDate({
  value,
  date,
  timestamp,
}: {
  value: string | null;
  date: string;
  timestamp: string | undefined;
}) {
  if (!value || !timestamp) return <>{date}</>;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="cursor-help rounded-4 outline-none focus-visible:shadow-button-neutral-focus"
        >
          <time dateTime={value}>{date}</time>
        </button>
      </TooltipTrigger>
      <TooltipContent>{timestamp}</TooltipContent>
    </Tooltip>
  );
}
