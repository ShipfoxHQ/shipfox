import {describe, expect, it} from '@shipfox/vitest/vi';
import {type PullRequestReference, resolveReferences} from './references.js';

const pr: PullRequestReference = {
  number: 7,
  head: 'shipfox/task-1-1-1',
  base: 'main',
  sha: 'abc',
  repository: 'acme/report-cli',
};
const noPullRequestPattern = /No pull request/u;

describe('resolveReferences', () => {
  it('replaces $pr and its fields anywhere in a value', () => {
    const value = {pull_request: '$pr', ref: '$pr.head', list: ['$pr.number', 'plain']};

    const resolved = resolveReferences(value, {pr: () => pr});

    expect(resolved).toEqual({pull_request: pr, ref: 'shipfox/task-1-1-1', list: [7, 'plain']});
  });

  it('puts a reference inside longer text as text, and derives the pull request url', () => {
    const resolved = resolveReferences(
      {text: 'Opened pull request: $pr.url', whole: '$pr.url', branch: 'on $pr.head.'},
      {pr: () => pr},
    );

    expect(resolved).toEqual({
      text: 'Opened pull request: https://github.com/acme/report-cli/pull/7',
      whole: 'https://github.com/acme/report-cli/pull/7',
      branch: 'on shipfox/task-1-1-1.',
    });
  });

  it('does not read the pull request when the value never names it', () => {
    const references = {
      pr: () => {
        throw new Error('No pull request has been opened.');
      },
    };

    expect(resolveReferences({body: 'Rename the flag'}, references)).toEqual({
      body: 'Rename the flag',
    });
  });

  it('fails when the value names a pull request that was not opened', () => {
    const references = {
      pr: () => {
        throw new Error('No pull request has been opened.');
      },
    };

    expect(() => resolveReferences({pull_request: '$pr'}, references)).toThrow(
      noPullRequestPattern,
    );
  });
});
