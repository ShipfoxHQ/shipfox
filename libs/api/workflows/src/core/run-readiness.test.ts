import {RUN_ISSUE_LOCATIONS_MAX} from '@shipfox/api-workflows-dto/inter-module';
import {template} from '#test/helpers/workflow-runs.js';
import {workflowModel} from '#test/index.js';
import {checkVariableReadiness} from './run-readiness.js';

describe('checkVariableReadiness', () => {
  it('lists each place a missing variable is read once', () => {
    const model = workflowModel({
      jobs: {
        build: {
          steps: [
            {key: 'first', run: `echo ${template('vars.REGION')} ${template('vars.REGION')}`},
            {name: 'Second', run: 'echo ok', env: {REGION: template('vars.REGION')}},
          ],
        },
      },
    });

    const issues = checkVariableReadiness({model, definedNames: new Set()});

    expect(issues).toEqual([
      {
        kind: 'variable-missing',
        key: 'REGION',
        effect: 'blocks-start',
        locations: [
          {jobKey: 'build', step: {key: 'first', index: 1}, field: 'run'},
          {
            jobKey: 'build',
            step: {name: 'Second', index: 2},
            field: 'env',
            envKey: 'REGION',
          },
        ],
      },
    ]);
  });

  it('caps the locations of an issue and counts the rest', () => {
    const readers = Object.fromEntries(
      Array.from({length: RUN_ISSUE_LOCATIONS_MAX + 2}, (_, index) => [
        `job${index}`,
        {steps: [{run: `echo ${template('vars.REGION')}`}]},
      ]),
    );

    const issues = checkVariableReadiness({
      model: workflowModel({jobs: readers}),
      definedNames: new Set(),
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.locations).toHaveLength(RUN_ISSUE_LOCATIONS_MAX);
    expect(issues[0]?.moreLocations).toBe(2);
  });

  it('orders issues by effect, then by key', () => {
    const model = workflowModel({
      jobs: {
        watch: {
          listening: {
            on: [{source: 'github', event: 'push', filter: 'vars.ZED == "1"'}],
            until: [{source: 'github', event: 'pull_request'}],
            onResolve: 'finish',
          },
          steps: [{run: 'echo watch', env: {A: template('vars.ALPHA'), Z: template('vars.ZED')}}],
        },
      },
    });

    const issues = checkVariableReadiness({model, definedNames: new Set()});

    expect(issues.map(({key, effect}) => `${effect}:${key}`)).toEqual([
      'blocks-start:ZED',
      'fails-job:ALPHA',
      'fails-job:ZED',
    ]);
  });

  it('reports nothing when every variable is defined', () => {
    const model = workflowModel({
      jobs: {build: {if: 'vars.DEPLOY == "true"', steps: [{run: 'echo build'}]}},
    });

    const issues = checkVariableReadiness({model, definedNames: new Set(['DEPLOY'])});

    expect(issues).toEqual([]);
  });
});
