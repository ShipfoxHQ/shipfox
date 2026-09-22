import {describe, expect, it} from '@shipfox/vitest/vi';
import {composeWorkflow} from './composer.js';

describe('composeWorkflow', () => {
  it('replaces markers at their indentation and keeps surrounding comments', () => {
    const composed = composeWorkflow(
      [
        'jobs:',
        '  build:',
        '    # bind:source',
        '    # part:source.checkout',
        '    # slot:test_command',
        '    # option:mode=fast begin',
        '    # option:mode=fast end',
      ].join('\n'),
      {checkout: '- key: checkout\n  prompt: Check out the repository.'},
    );

    expect(composed).toBe(
      [
        'jobs:',
        '  build:',
        '    # bind:source',
        '    - key: checkout',
        '      prompt: Check out the repository.',
        '    # slot:test_command',
        '    # option:mode=fast begin',
        '    # option:mode=fast end',
      ].join('\n'),
    );
  });

  it('fails when a marker has no matching part', () => {
    expect(() => composeWorkflow('# part:tracker.trigger', {})).toThrow(
      'Missing workflow template part: tracker.trigger',
    );
  });
});
