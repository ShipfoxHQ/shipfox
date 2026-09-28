import {defineAction} from '@shipfox/actions';
import {describe} from './lib/describe.ts';

interface Inputs {
  repo: string;
  issue: number;
  comment: string;
}

export default defineAction<Inputs>(async ({inputs, tools, context, log, signal}) => {
  const issue = await tools.gitea.call(
    'get_issue',
    {repo: inputs.repo, index: inputs.issue},
    {signal},
  );
  const {title} = issue.structured as {title: string};
  log.info(describe('issue', title));

  const run = await tools.shipfox.call('get_workflow_run', {run_id: context.runId}, {signal});
  const {status} = (run.structured as {run: {status: string}}).run;
  log.info(describe('run', status));

  await tools.gitea.call(
    'comment_on_issue',
    {repo: inputs.repo, index: inputs.issue, body: inputs.comment},
    {signal},
  );
  return {title, run_status: status};
});
