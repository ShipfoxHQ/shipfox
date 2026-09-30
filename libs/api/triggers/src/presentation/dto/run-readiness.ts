import type {RunIssueDto} from '@shipfox/api-triggers-dto';
import type {RunIssue} from '@shipfox/api-workflows-dto/inter-module';

export function toRunIssueDto(issue: RunIssue): RunIssueDto {
  return {
    kind: issue.kind,
    key: issue.key,
    locations: issue.locations.map(({jobKey, step, field, envKey}) => ({
      ...(jobKey !== undefined && {job_key: jobKey}),
      ...(step !== undefined && {step}),
      field,
      ...(envKey !== undefined && {env_key: envKey}),
    })),
    ...(issue.moreLocations !== undefined && {more_locations: issue.moreLocations}),
    effect: issue.effect,
  };
}
