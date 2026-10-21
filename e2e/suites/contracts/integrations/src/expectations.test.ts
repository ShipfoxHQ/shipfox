import {describe, expect, it} from '@shipfox/vitest/vi';
import {failedChecks, valueAt} from './expectations.js';

const result = {
  id: 'I1',
  number: 7,
  open: true,
  labels: [{name: 'bug', color: 'red'}, {name: 'p1'}],
  author: {login: 'octocat'},
  body: 'Contract café',
};

describe('failedChecks', () => {
  it('passes a result that holds every check', () => {
    expect(
      failedChecks({
        expect: {
          shape: {id: 'string', number: 'number', open: 'boolean', labels: [{name: 'string'}]},
          values: {id: 'I1', number: 7, 'author.login': 'octocat', 'labels[1].name': 'p1'},
          includes: {labels: {name: 'bug', color: 'red'}},
          excludes: {labels: {name: 'wontfix'}},
          matches: {body: '^Contract'},
        },
        result,
      }),
    ).toEqual([]);
  });

  it('fails a shape leaf that is absent or of another type', () => {
    const failures = failedChecks({
      expect: {shape: {missing: 'string', number: 'string', author: 'object'}},
      result,
    });

    expect(failures).toEqual([
      'shape: missing is absent, not string',
      'shape: number is 7, not string',
    ]);
  });

  it('fails a shape on the first item of an empty list', () => {
    const failures = failedChecks({
      expect: {shape: {items: [{id: 'string'}]}},
      result: {items: []},
    });

    expect(failures).toEqual(['shape: items[0].id is absent, not string']);
  });

  it('never equals a value of another type', () => {
    const failures = failedChecks({expect: {values: {number: '7', id: 'I1'}}, result});

    expect(failures).toEqual(['values: number is 7, not "7"']);
  });

  it('reads an absent text value as empty, as the generated gate does', () => {
    expect(failedChecks({expect: {values: {'items[0].id': ''}}, result: {items: []}})).toEqual([]);
    expect(failedChecks({expect: {values: {'items[0].id': 'I1'}}, result: {items: []}})).toEqual([
      'values: items[0].id is absent, not "I1"',
    ]);
    expect(failedChecks({expect: {values: {'items[0].done': false}}, result: {items: []}})).toEqual(
      ['values: items[0].done is absent, not false'],
    );
  });

  it('fails includes without a matching item, and excludes with one', () => {
    const failures = failedChecks({
      expect: {includes: {labels: {name: 'bug', color: 'blue'}}, excludes: {labels: {name: 'p1'}}},
      result,
    });

    expect(failures).toEqual([
      'includes: no item of labels holds {"name":"bug","color":"blue"}',
      'excludes: an item of labels holds {"name":"p1"}',
    ]);
  });

  it('fails a list check on a path that is not a list', () => {
    const failures = failedChecks({expect: {excludes: {author: {login: 'x'}}}, result});

    expect(failures).toEqual(['excludes: author is {"login":"octocat"}, not a list']);
  });

  it('matches text values and a text result', () => {
    expect(failedChecks({expect: {matches: {number: '7'}}, result})).toEqual([
      'matches: number is 7, which does not match /7/',
    ]);
    expect(failedChecks({expect: {text: ['rows: \\d+']}, result: 'rows: 3'})).toEqual([]);
    expect(failedChecks({expect: {text: ['rows']}, result})).toEqual([
      'text: the result does not match /rows/',
    ]);
  });

  it('checks values only for a tool whose output schema is closed', () => {
    const failures = failedChecks({
      expect: {shape: {missing: 'string'}, values: {id: 'I1'}},
      result,
      valuesOnly: true,
    });

    expect(failures).toEqual([]);
  });
});

describe('valueAt', () => {
  it('reads a nested path, and nothing for a path that leads nowhere', () => {
    expect(valueAt(result, 'labels[0].name')).toBe('bug');
    expect(valueAt(result, 'labels[5].name')).toBeUndefined();
    expect(valueAt('text', 'id')).toBeUndefined();
  });
});
