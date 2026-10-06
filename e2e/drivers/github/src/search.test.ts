import {GITHUB_STATELESS_INSTALLATION_TOKEN, startGithubApiMock} from './github-api.js';

async function startMock() {
  const mock = await startGithubApiMock({endpoint: new URL('http://127.0.0.1:0')});
  const search = async (query: string) => {
    const response = await fetch(
      new URL(`/search/issues?${new URLSearchParams({q: query})}`, mock.endpoint),
      {
        headers: {authorization: `bearer ${GITHUB_STATELESS_INSTALLATION_TOKEN}`},
      },
    );
    return (await response.json()) as {
      total_count: number;
      items: Array<Record<string, unknown>>;
    };
  };
  mock.issues.set(1, {repository: 'acme/app', title: 'Fixture issue: long body'});
  mock.issues.set(2, {repository: 'acme/app', title: 'Closed fixture', state: 'closed'});
  mock.issues.set(3, {repository: 'acme/app', title: 'Unrelated', body: 'mentions the Fixture'});
  mock.issues.set(4, {repository: 'acme/other', title: 'Fixture elsewhere'});
  mock.pullRequests.set(5, {
    repository: 'acme/app',
    ref: 'feature',
    sha: 'a'.repeat(40),
    title: 'Fixture PR',
  });
  return {mock, search};
}

describe('GitHub API mock issue search', () => {
  it('matches words on the title or body within the repository, newest first', async () => {
    const {mock, search} = await startMock();

    try {
      const result = await search('Fixture repo:acme/app');

      expect(result.total_count).toBe(4);
      expect(result.items.map((item) => item.number)).toEqual([5, 3, 2, 1]);
    } finally {
      await mock.stop();
    }
  });

  it('narrows to issues or pull requests with is:issue and is:pr', async () => {
    const {mock, search} = await startMock();

    try {
      const issues = await search('is:issue Fixture repo:acme/app');
      const pullRequests = await search('Fixture repo:acme/app is:pr');

      expect(issues.items.map((item) => item.number)).toEqual([3, 2, 1]);
      expect(pullRequests.items).toMatchObject([
        {
          number: 5,
          title: 'Fixture PR',
          state: 'open',
          pull_request: {html_url: 'https://github.com/acme/app/pull/5'},
        },
      ]);
    } finally {
      await mock.stop();
    }
  });

  it('filters on is:open and is:closed, and on quoted phrases', async () => {
    const {mock, search} = await startMock();

    try {
      const open = await search('is:open is:issue repo:acme/app');
      const closed = await search('is:closed repo:acme/app');
      const phrase = await search('"fixture issue" repo:acme/app');

      expect(open.items.map((item) => item.number)).toEqual([3, 1]);
      expect(closed.items.map((item) => item.number)).toEqual([2]);
      expect(phrase.items.map((item) => item.number)).toEqual([1]);
    } finally {
      await mock.stop();
    }
  });

  it('answers an empty result for a repository nothing is seeded for', async () => {
    const {mock, search} = await startMock();

    try {
      const result = await search('Fixture repo:acme/empty');

      expect(result).toMatchObject({total_count: 0, items: []});
    } finally {
      await mock.stop();
    }
  });

  it('searches every repository when the query names none', async () => {
    const {mock, search} = await startMock();

    try {
      const result = await search('Fixture is:issue');

      expect(result.items.map((item) => item.number)).toEqual([4, 3, 2, 1]);
    } finally {
      await mock.stop();
    }
  });
});
