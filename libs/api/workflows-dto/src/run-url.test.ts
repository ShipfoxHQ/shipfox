import {workflowRunUrl} from './run-url.js';

describe('workflowRunUrl', () => {
  it.each([
    'https://app.example.test',
    'https://app.example.test/',
  ])('joins the run permalink to %s', (clientBaseUrl) => {
    expect(workflowRunUrl({clientBaseUrl, runId: 'run-1'})).toBe(
      'https://app.example.test/runs/run-1',
    );
  });
});
