import {type CreateWorkspaceBodyDto, createWorkspaceBodySchema} from '@shipfox/api-workspaces-dto';
import {type FieldErrors, fieldErrorsFromZod} from './form-utils.js';

type WorkspaceField = 'name';

export type WorkspaceOnboardingFormResult =
  | {ok: true; body: CreateWorkspaceBodyDto}
  | {ok: false; fieldErrors: FieldErrors<WorkspaceField>};

export function parseWorkspaceOnboardingForm(input: {name: string}): WorkspaceOnboardingFormResult {
  const parsed = createWorkspaceBodySchema.safeParse({name: input.name.trim()});
  if (!parsed.success) {
    return {ok: false, fieldErrors: fieldErrorsFromZod<WorkspaceField>(parsed.error)};
  }

  return {ok: true, body: parsed.data};
}
