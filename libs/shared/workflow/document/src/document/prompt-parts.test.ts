import {workflowDocumentSchema} from './workflow-document.js';

function parsePrompt(prompt: unknown) {
  return workflowDocumentSchema.safeParse({
    name: 'prompt parts',
    jobs: {review: {steps: [{prompt}]}},
  });
}

function issueMessages(prompt: unknown): string[] {
  const result = parsePrompt(prompt);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

describe('agent step prompt parts', () => {
  it.each([
    ['a string', 'Review the change.'],
    ['a list of strings', ['One.', 'Two.']],
    ['a list with a file part', ['Intro.', {file: './.shipfox/prompts/review.md'}]],
    ['a single part', ['Only.']],
  ])('accepts %s', (_name, prompt) => {
    expect(parsePrompt(prompt).success).toBe(true);
  });

  it('accepts up to 64 parts', () => {
    expect(parsePrompt(Array.from({length: 64}, () => 'Part.')).success).toBe(true);
    expect(parsePrompt(Array.from({length: 65}, () => 'Part.')).success).toBe(false);
  });

  it.each([
    ['an empty list', []],
    ['an empty string part', ['One.', '']],
    ['a nested list', ['One.', ['Two.']]],
    ['a number part', ['One.', 2]],
    ['a file part with extra keys', [{file: './a.md', extra: true}]],
    ['a file part without a path', [{file: ''}]],
    ['an object without file', [{path: './a.md'}]],
  ])('rejects %s', (_name, prompt) => {
    expect(parsePrompt(prompt).success).toBe(false);
  });

  it('rejects a cyclic list as an invalid item', () => {
    const cycle: unknown[] = [];
    cycle.push(cycle);

    expect(parsePrompt(cycle).success).toBe(false);
  });

  it.each([
    ['a path outside ./', 'prompts/a.md', 'must start with `./`'],
    ['a parent path', './../a.md', 'normalized'],
    ['an absolute path', '/etc/passwd', 'relative'],
    ['a URL', 'https://example.com/a.md', 'Prompt file URLs are not supported'],
    ['a path ending in a slash', './prompts/', 'normalized'],
    ['an interpolated path', './prompts/$' + '{{ inputs.name }}.md', 'literal'],
  ])('rejects %s as a file path', (_name, file, message) => {
    expect(issueMessages([{file}]).join('\n')).toContain(message);
  });

  it('keeps a file path with an escaped interpolation marker literal', () => {
    expect(parsePrompt([{file: './prompts/$' + '${{ a.md'}]).success).toBe(true);
  });
});
