import {type GithubIssueFixture, issuePayload} from './issues.js';
import {
  effectiveState,
  type GithubPullRequestFixture,
  pullRequestIssuePayload,
  sameRepository,
} from './pull-requests.js';

const QUERY_TOKEN = /"[^"]*"|\S+/gu;

interface SearchTerms {
  repository: string | undefined;
  kind: 'issue' | 'pull_request' | undefined;
  state: 'open' | 'closed' | undefined;
  text: string[];
}

function parseQuery(query: string): SearchTerms {
  const terms: SearchTerms = {
    repository: undefined,
    kind: undefined,
    state: undefined,
    text: [],
  };
  for (const token of query.match(QUERY_TOKEN) ?? []) {
    const lower = token.toLowerCase();
    if (lower.startsWith('repo:')) terms.repository = token.slice('repo:'.length);
    else if (lower === 'is:issue') terms.kind = 'issue';
    else if (lower === 'is:pr' || lower === 'is:pull-request') terms.kind = 'pull_request';
    else if (lower === 'is:open' || lower === 'is:closed')
      terms.state = lower.slice('is:'.length) as 'open' | 'closed';
    else terms.text.push(lower.replaceAll('"', ''));
  }
  return terms;
}

/**
 * The issues and pull requests a `GET /search/issues` query matches, as the API answers them: the
 * `repo:` repository, `is:issue`, `is:pr`, `is:open`, and `is:closed`, and every other word as a
 * case-insensitive match on the title or body. Without `is:issue` or `is:pr`, both kinds match.
 * Returns undefined when the query names no repository that holds a seeded issue or pull request.
 */
export function searchIssues({
  issues,
  pullRequests,
  query,
}: {
  issues: ReadonlyMap<number, GithubIssueFixture>;
  pullRequests: ReadonlyMap<number, GithubPullRequestFixture>;
  query: string;
}): {total_count: number; incomplete_results: false; items: Record<string, unknown>[]} | undefined {
  const terms = parseQuery(query);
  const {repository} = terms;
  if (repository === undefined) return undefined;
  const repositoryIssues = [...issues.entries()].filter(([, issue]) =>
    sameRepository(issue.repository, repository),
  );
  const repositoryPullRequests = [...pullRequests.entries()].filter(([, pullRequest]) =>
    sameRepository(pullRequest.repository, repository),
  );
  if (repositoryIssues.length === 0 && repositoryPullRequests.length === 0) return undefined;

  const candidates = [
    ...(terms.kind === 'pull_request'
      ? []
      : repositoryIssues.map(([number, issue]) => ({
          number,
          state: issue.state ?? 'open',
          text: `${issue.title} ${issue.body ?? ''}`.toLowerCase(),
          item: {...issuePayload(number, issue), score: 1},
        }))),
    ...(terms.kind === 'issue'
      ? []
      : repositoryPullRequests.map(([number, pullRequest]) => ({
          number,
          state: effectiveState(pullRequest),
          text: `${pullRequest.title ?? ''} ${pullRequest.body ?? ''}`.toLowerCase(),
          item: {...pullRequestIssuePayload(number, pullRequest), score: 1},
        }))),
  ]
    .filter((candidate) => terms.state === undefined || candidate.state === terms.state)
    .filter((candidate) => terms.text.every((word) => candidate.text.includes(word)))
    .sort((left, right) => right.number - left.number);
  return {
    total_count: candidates.length,
    incomplete_results: false,
    items: candidates.map((candidate) => candidate.item),
  };
}
