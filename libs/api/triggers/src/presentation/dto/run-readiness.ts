import type {RunIssueDto, RunIssueLocationDto} from '@shipfox/api-triggers-dto';
import type {RunIssue} from '@shipfox/api-workflows-dto/inter-module';
import type {RunSecretInputReference, TriggerRunIssue} from '#core/trigger-run-readiness.js';

type RunIssueLocation = RunSecretInputReference['locations'][number];

function toLocationDto({jobKey, step, field, envKey}: RunIssueLocation): RunIssueLocationDto {
  return {
    ...(jobKey !== undefined && {job_key: jobKey}),
    ...(step !== undefined && {step}),
    field,
    ...(envKey !== undefined && {env_key: envKey}),
  };
}

export function toRunIssueDto(issue: RunIssue | TriggerRunIssue): RunIssueDto {
  switch (issue.kind) {
    case 'trigger-secret-missing':
      return {
        kind: issue.kind,
        key: issue.key,
        trigger: issue.trigger,
        effect: issue.effect,
      };
    case 'agent-config-invalid':
      return {
        kind: issue.kind,
        reason: issue.reason,
        ...(issue.model !== undefined && {model: issue.model}),
        ...(issue.provider !== undefined && {provider: issue.provider}),
        locations: issue.locations.map(toLocationDto),
        ...(issue.moreLocations !== undefined && {more_locations: issue.moreLocations}),
        effect: issue.effect,
      };
    case 'secret-input-unmapped':
      return {
        kind: issue.kind,
        key: issue.key,
        trigger: issue.trigger,
        locations: issue.locations.map(toLocationDto),
        ...(issue.moreLocations !== undefined && {more_locations: issue.moreLocations}),
        effect: issue.effect,
      };
    case 'variable-missing':
    case 'secret-missing':
      return {
        kind: issue.kind,
        key: issue.key,
        locations: issue.locations.map(toLocationDto),
        ...(issue.moreLocations !== undefined && {more_locations: issue.moreLocations}),
        effect: issue.effect,
      };
  }
}
