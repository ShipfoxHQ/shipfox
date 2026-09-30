import {expression, template} from '#test/helpers/workflow-runs.js';
import {workflowModel} from '#test/index.js';
import {collectRunRequirements} from './run-requirements.js';

describe('collectRunRequirements', () => {
  test('locates a variable in a predicate, a job field and a step field', () => {
    const model = workflowModel({
      jobs: {
        build: {
          if: 'vars.JOB_IF == "true"',
          steps: [
            {key: 'compile', name: 'Compile', run: 'echo ok'},
            {
              key: 'deploy',
              name: 'Deploy',
              if: expression('vars.STEP_IF == "true"'),
              run: `echo ${template('vars.TARGET')}`,
              env: {TOKEN: template('vars.TOKEN')},
            },
          ],
        },
      },
    });

    const {variables} = collectRunRequirements(model, model.jobs);

    expect(variables).toEqual([
      {key: 'JOB_IF', field: 'env', source: 'vars.JOB_IF == "true"', jobKey: 'build'},
      {
        key: 'STEP_IF',
        field: 'env',
        source: 'vars.STEP_IF == "true"',
        jobKey: 'build',
        step: {key: 'deploy', name: 'Deploy', index: 2},
      },
      {
        key: 'TARGET',
        field: 'run',
        source: 'vars.TARGET',
        jobKey: 'build',
        step: {key: 'deploy', name: 'Deploy', index: 2},
      },
      {
        key: 'TOKEN',
        field: 'env',
        envKey: 'TOKEN',
        source: 'vars.TOKEN',
        jobKey: 'build',
        step: {key: 'deploy', name: 'Deploy', index: 2},
      },
    ]);
  });

  test('gives workflow-level references no job or step location', () => {
    const model = workflowModel({
      runName: template('vars.ENVIRONMENT'),
      jobs: {build: {steps: [{run: 'echo ok'}]}},
    });

    const {variables} = collectRunRequirements(model, model.jobs);

    expect(variables).toEqual([
      {key: 'ENVIRONMENT', field: 'workflow.run_name', source: 'vars.ENVIRONMENT'},
    ]);
  });

  test('collects secret references with their store and location', () => {
    const model = workflowModel({
      jobs: {
        build: {
          steps: [
            {
              key: 'publish',
              run: 'publish',
              env: {
                NPM_TOKEN: template('secrets.NPM_TOKEN'),
                REGISTRY_TOKEN: template('secrets.inputs.REGISTRY'),
              },
            },
          ],
        },
      },
    });

    const {secrets, variables} = collectRunRequirements(model, model.jobs);

    expect(variables).toEqual([]);
    expect(secrets).toEqual([
      {
        key: 'NPM_TOKEN',
        store: 'local',
        field: 'env',
        envKey: 'NPM_TOKEN',
        source: 'secrets.NPM_TOKEN',
        jobKey: 'build',
        step: {key: 'publish', index: 1},
      },
      {
        key: 'REGISTRY',
        store: 'inputs',
        field: 'env',
        envKey: 'REGISTRY_TOKEN',
        source: 'secrets.inputs.REGISTRY',
        jobKey: 'build',
        step: {key: 'publish', index: 1},
      },
    ]);
  });

  test('still collects a reference wrapped in has()', () => {
    const model = workflowModel({
      jobs: {
        build: {
          if: 'has(vars.OPTIONAL) ? vars.OPTIONAL == "true" : false',
          steps: [{run: `echo ${template("has(vars.GUARDED) ? vars.GUARDED : ''")}`}],
        },
      },
    });

    const keys = collectRunRequirements(model, model.jobs).variables.map(({key}) => key);

    expect(keys).toEqual(['OPTIONAL', 'OPTIONAL', 'GUARDED', 'GUARDED']);
  });

  test('reads predicates from every job but templates only from the given jobs', () => {
    const model = workflowModel({
      jobs: {
        build: {steps: [{run: `echo ${template('vars.BUILD_ONLY')}`}]},
        deploy: {
          if: 'vars.DEPLOY_IF == "true"',
          steps: [{run: `echo ${template('vars.DEPLOY_ONLY')}`}],
        },
      },
    });
    const build = model.jobs.find((job) => job.key === 'build');
    if (!build) throw new Error('Expected build job');

    const keys = collectRunRequirements(model, [build]).variables.map(({key}) => key);

    expect(keys).toEqual(['DEPLOY_IF', 'BUILD_ONLY']);
  });
});
