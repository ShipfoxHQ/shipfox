import type {WorkflowDocumentJobCheckout} from '@shipfox/workflow-document';
import type {WorkflowModelJobCheckout} from '../entities/workflow-model.js';

export const DEFAULT_JOB_CHECKOUT: WorkflowModelJobCheckout = {
  permissions: {contents: 'read'},
  persistCredentials: true,
};

export function normalizeJobCheckout(
  checkout: WorkflowDocumentJobCheckout | undefined,
): WorkflowModelJobCheckout {
  return {
    permissions: {
      contents: checkout?.permissions?.contents ?? DEFAULT_JOB_CHECKOUT.permissions.contents,
    },
    persistCredentials:
      checkout?.['persist-credentials'] ?? DEFAULT_JOB_CHECKOUT.persistCredentials,
  };
}
