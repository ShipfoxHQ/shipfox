import type {WorkflowModel} from '@shipfox/api-definitions-dto';
import {workflowModel} from './workflow-model.js';

describe('workflowModel', () => {
  it('defaults jobs to a non-empty canonical runner label set', () => {
    const model = workflowModel();

    expect(model.jobs[0]?.runner).toEqual(['ubuntu-latest']);
  });

  it('uses workflow and job runner overrides', () => {
    const model = workflowModel({
      runner: 'ubuntu-22',
      jobs: {
        build: {
          steps: [{run: 'pnpm build'}],
        },
        test: {
          runner: ['ubuntu-22', 'node-22'],
          steps: [{run: 'pnpm test'}],
        },
      },
    });

    expect(model.jobs.map((job: WorkflowModel['jobs'][number]) => job.runner)).toEqual([
      ['ubuntu-22'],
      ['ubuntu-22', 'node-22'],
    ]);
  });
});
