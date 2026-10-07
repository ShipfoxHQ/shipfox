import type {WorkflowDocument} from '@shipfox/workflow-document';
import {agentValidationCatalog} from '#test/agent-validation-catalog.js';
import {InvalidWorkflowModelError} from './invalid-workflow-model-error.js';
import {normalizeWorkflowDocument} from './normalize-workflow-document.js';

function interpolation(source: string): string {
  return '$'.concat('{{ ', source, ' }}');
}

function normalizePrompt(
  prompt: NonNullable<WorkflowDocument['jobs'][string]['steps'][number]['prompt']>,
  promptFiles?: ReadonlyMap<string, string>,
) {
  return normalizeWorkflowDocument(
    {
      name: 'prompt parts',
      runner: 'ubuntu-latest',
      jobs: {review: {steps: [{run: 'true'}, {key: 'agent', prompt}]}},
    },
    {agentValidationCatalog, promptFiles},
  );
}

function agentStep(model: ReturnType<typeof normalizePrompt>) {
  const step = model.jobs[0]?.steps[1];
  if (step?.kind !== 'agent') throw new Error('Expected an agent step');
  return step;
}

function expectInvalid(
  prompt: Parameters<typeof normalizePrompt>[0],
  promptFiles?: ReadonlyMap<string, string>,
) {
  try {
    normalizePrompt(prompt, promptFiles);
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidWorkflowModelError);
    return (error as InvalidWorkflowModelError).issues;
  }
  return expect.fail('Expected InvalidWorkflowModelError');
}

describe('normalizeAgentPrompt', () => {
  it('keeps a string prompt byte for byte', () => {
    const prompt = '  Review the change.\n\n\n';

    const step = agentStep(normalizePrompt(prompt));

    expect(step.prompt).toBe(prompt);
    expect(step.templates).toBeUndefined();
  });

  it('joins parts with one blank line and removes trailing line breaks from each part', () => {
    const step = agentStep(normalizePrompt(['First.\n', 'Second.\r\n\r\n', '  Third  ', 'Last.']));

    expect(step.prompt).toBe('First.\n\nSecond.\n\n  Third  \n\nLast.');
    expect(step.templates).toBeUndefined();
  });

  it('keeps inner line breaks of a part', () => {
    const step = agentStep(normalizePrompt(['One\n\nTwo\n', 'Three']));

    expect(step.prompt).toBe('One\n\nTwo\n\nThree');
  });

  it('accepts a single anchored string part', () => {
    const step = agentStep(normalizePrompt(['Follow the rules.']));

    expect(step.prompt).toBe('Follow the rules.');
  });

  it('builds one template across the parts', () => {
    const step = agentStep(
      normalizePrompt(['Review', `PR: ${interpolation('inputs.number')}\n`, 'Be brief.']),
    );

    expect(step.prompt).toBe(`Review\n\nPR: ${interpolation('inputs.number')}\n\nBe brief.`);
    expect(step.templates?.prompt).toEqual([
      {kind: 'literal', value: 'Review\n\nPR: '},
      expect.objectContaining({kind: 'deferred', roots: ['inputs']}),
      {kind: 'literal', value: '\n\nBe brief.'},
    ]);
  });

  it('checks the template syntax of each part and names the part', () => {
    const issues = expectInvalid(['Fine.', 'Open ' + '$' + '{{ inputs.number', 'close }}']);

    expect(issues).toEqual([
      expect.objectContaining({
        code: 'invalid-interpolation-template',
        path: ['jobs', 'review', 'steps', 1, 'prompt', 1],
      }),
    ]);
  });

  it('does not let an expression span two parts', () => {
    const issues = expectInvalid(['Value ' + '$' + '{{ inputs.a +', 'inputs.b }}']);

    expect(issues).toEqual([
      expect.objectContaining({
        code: 'invalid-interpolation-template',
        path: ['jobs', 'review', 'steps', 1, 'prompt', 0],
      }),
    ]);
  });

  it('reports an unknown context in the part that uses it', () => {
    const issues = expectInvalid(['Fine.', 'Fine.', interpolation('nope.value')]);

    expect(issues).toEqual([
      expect.objectContaining({
        code: 'unknown-interpolation-context',
        path: ['jobs', 'review', 'steps', 1, 'prompt', 2],
      }),
    ]);
  });

  it('refuses a file part when no prompt files were read', () => {
    const issues = expectInvalid(['Intro.', {file: './prompts/review.md'}]);

    expect(issues).toEqual([
      expect.objectContaining({
        code: 'prompt-file-invalid',
        path: ['jobs', 'review', 'steps', 1, 'prompt', 1],
        details: {file: './prompts/review.md'},
      }),
    ]);
  });

  it('inlines the file text between the other parts', () => {
    const files = new Map([['./prompts/review.md', 'Check the diff.\n\n']]);

    const step = agentStep(
      normalizePrompt(['Intro.', {file: './prompts/review.md'}, 'Outro.'], files),
    );

    expect(step.prompt).toBe('Intro.\n\nCheck the diff.\n\nOutro.');
    expect(step.templates).toBeUndefined();
  });

  it('accepts a prompt made of one file', () => {
    const files = new Map([['./prompts/review.md', 'Check the diff.\n']]);

    const step = agentStep(normalizePrompt([{file: './prompts/review.md'}], files));

    expect(step.prompt).toBe('Check the diff.');
  });

  it('evaluates an expression in a file like inline text', () => {
    const files = new Map([['./prompts/review.md', `PR: ${interpolation('inputs.number')}\n`]]);

    const step = agentStep(normalizePrompt(['Review', {file: './prompts/review.md'}], files));

    expect(step.templates?.prompt).toEqual([
      {kind: 'literal', value: 'Review\n\nPR: '},
      expect.objectContaining({kind: 'deferred', roots: ['inputs']}),
    ]);
  });

  it('keeps an escaped expression in a file literal', () => {
    const files = new Map([
      ['./prompts/review.md', `Write $${interpolation('inputs.number')} as is.`],
    ]);

    const step = agentStep(normalizePrompt([{file: './prompts/review.md'}], files));

    expect(step.templates).toBeUndefined();
  });

  it('names the file when an expression in it is invalid', () => {
    const files = new Map([['./prompts/review.md', interpolation('nope.value')]]);

    const issues = expectInvalid(['Intro.', {file: './prompts/review.md'}], files);

    expect(issues).toEqual([
      expect.objectContaining({
        code: 'unknown-interpolation-context',
        message: expect.stringContaining('Prompt file "./prompts/review.md"'),
        path: ['jobs', 'review', 'steps', 1, 'prompt', 1],
        details: expect.objectContaining({file: './prompts/review.md'}),
      }),
    ]);
  });

  it('does not let an expression span a file and the next part', () => {
    const files = new Map([['./prompts/review.md', 'Value ' + '$' + '{{ inputs.a +']]);

    const issues = expectInvalid([{file: './prompts/review.md'}, 'inputs.b }}'], files);

    expect(issues).toEqual([
      expect.objectContaining({
        code: 'invalid-interpolation-template',
        path: ['jobs', 'review', 'steps', 1, 'prompt', 0],
      }),
    ]);
  });
});
