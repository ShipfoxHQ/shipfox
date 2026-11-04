import {ApiError} from '@shipfox/client-api';

export type DeleteProjectFormError =
  | {kind: 'field'; field: 'name'; message: string}
  | {kind: 'form'; message: string};

export function deleteProjectErrorToFormError(error: unknown): DeleteProjectFormError {
  if (error instanceof ApiError) {
    if (error.code === 'project-name-mismatch') {
      return {kind: 'field', field: 'name', message: "The name doesn't match the project."};
    }
    if (error.code === 'default-project-undeletable') {
      return {kind: 'form', message: "The default project can't be deleted."};
    }
    if (error.code === 'impersonation-not-permitted') {
      return {kind: 'form', message: 'Only a workspace member can delete a project.'};
    }
    if (error.status === 403) {
      return {kind: 'form', message: 'Only workspace admins can delete this project.'};
    }
    if (error.status === 404) {
      return {kind: 'form', message: 'This project no longer exists.'};
    }
  }
  return {kind: 'form', message: 'Could not delete the project. Try again.'};
}
