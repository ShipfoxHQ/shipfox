import {RUN_ISSUE_LOCATIONS_MAX} from '@shipfox/api-workflows-dto/inter-module';
import {template} from '#test/helpers/workflow-runs.js';
import {workflowModel} from '#test/index.js';
import {
  checkSecretReadiness,
  checkVariableReadiness,
  collectSecretInputReferences,
} from './run-readiness.js';

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

describe('checkSecretReadiness', () => {
  it('reports a missing local secret as failing the job, and skips defined and input secrets', () => {
    const model = workflowModel({
      jobs: {
        build: {
          steps: [
            {
              key: 'deploy',
              run: 'echo deploy',
              env: {
                TOKEN: template('secrets.API_TOKEN'),
                KNOWN: template('secrets.KNOWN'),
                INPUT: template('secrets.inputs.DEPLOY'),
              },
            },
          ],
        },
      },
    });

    const issues = checkSecretReadiness({model, definedNames: new Set(['KNOWN'])});

    expect(issues).toEqual([
      {
        kind: 'secret-missing',
        key: 'API_TOKEN',
        effect: 'fails-job',
        locations: [
          {jobKey: 'build', step: {key: 'deploy', index: 1}, field: 'env', envKey: 'TOKEN'},
        ],
      },
    ]);
  });

  it('caps the locations of an issue and counts the rest', () => {
    const readers = Object.fromEntries(
      Array.from({length: RUN_ISSUE_LOCATIONS_MAX + 1}, (_, index) => [
        `job${index}`,
        {steps: [{run: 'echo', env: {TOKEN: template('secrets.API_TOKEN')}}]},
      ]),
    );

    const issues = checkSecretReadiness({
      model: workflowModel({jobs: readers}),
      definedNames: new Set(),
    });

    expect(issues[0]?.locations).toHaveLength(RUN_ISSUE_LOCATIONS_MAX);
    expect(issues[0]?.moreLocations).toBe(1);
  });
});

describe('collectSecretInputReferences', () => {
  it('lists each secret input by key with where it is read', () => {
    const model = workflowModel({
      jobs: {
        build: {
          steps: [
            {
              run: 'echo',
              env: {
                B: template('secrets.inputs.BETA'),
                A: template('secrets.inputs.ALPHA'),
                LOCAL: template('secrets.LOCAL'),
              },
            },
          ],
        },
      },
    });

    const references = collectSecretInputReferences(model);

    expect(references).toEqual([
      {
        key: 'ALPHA',
        locations: [{jobKey: 'build', step: {index: 1}, field: 'env', envKey: 'A'}],
      },
      {
        key: 'BETA',
        locations: [{jobKey: 'build', step: {index: 1}, field: 'env', envKey: 'B'}],
      },
    ]);
  });
});
