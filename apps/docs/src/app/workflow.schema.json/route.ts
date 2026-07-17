import {buildWorkflowJsonSchema} from '@shipfox/workflow-document';
import {toUrl} from '@/url';

export const revalidate = false;
export const dynamic = 'force-static';

export function GET() {
  return Response.json(buildWorkflowJsonSchema({id: toUrl('/workflow.schema.json')}));
}
