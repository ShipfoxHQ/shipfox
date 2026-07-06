import {Badge} from '@shipfox/react-ui/badge';
import {Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui/tooltip';

// Marks a skipped node whose `if:` condition could not be evaluated
// (condition_errored). Shown alongside the muted skip so a broken condition is
// not mistaken for a routine skip, at both the job (DAG) and step (list) levels.
export function ConditionErrorBadge({level}: {level: 'job' | 'step'}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="shrink-0">
          <Badge variant="warning" size="2xs">
            condition error
          </Badge>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        The {level} condition could not be evaluated, so the {level} was skipped.
      </TooltipContent>
    </Tooltip>
  );
}
