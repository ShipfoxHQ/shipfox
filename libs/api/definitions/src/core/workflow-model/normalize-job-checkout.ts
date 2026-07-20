import {DEFAULT_JOB_CHECKOUT, type WorkflowModelJobCheckout} from '@shipfox/api-definitions-dto';
import type {WorkflowDocumentJobCheckout} from '@shipfox/workflow-document';

export {DEFAULT_JOB_CHECKOUT};

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
