import {parseBootstrap} from '#bootstrap.js';
import {matchPublishGrant} from '#publish/grants.js';
import type {GithubOidcClaims} from '#publish/oidc.js';

const claims: GithubOidcClaims = {
  iss: 'https://token.actions.githubusercontent.com',
  jti: 'token-1',
  repository: 'acme/tools',
  repository_id: '10',
  repository_owner_id: '20',
  workflow_ref: 'acme/tools/.github/workflows/release.yml@refs/tags/v1.2.3',
  ref: 'refs/tags/v1.2.3',
  sha: 'abc',
  run_id: '1',
  run_attempt: '1',
  runner_environment: 'github-hosted',
};

function bootstrapWith({refs, namespaces = ['acme']}: {refs?: string[]; namespaces?: string[]}) {
  const publisher = `
      - provider: github
        repository_id: "10"
        repository_owner_id: "20"
        repository: acme/tools
        workflow: .github/workflows/release.yml
${refs ? `        ref: [${refs.join(', ')}]` : ''}`;
  const text = namespaces
    .map(
      (namespace) => `  ${namespace}:\n    profile: {display_name: X}\n    publishers:${publisher}`,
    )
    .join('\n');
  return parseBootstrap({path: 'test.yaml', text: `namespaces:\n${text}`});
}

describe('matchPublishGrant', () => {
  it.each([
    ['an exact ref', 'refs/tags/v1.2.3', true],
    ['a trailing wildcard', 'refs/tags/v*', true],
    ['a wildcard in another segment', 'refs/tags/*', true],
    ['another exact ref', 'refs/heads/main', false],
    ['a wildcard that would cross a slash', 'refs/*', false],
    ['a dot, which is not a wildcard', 'refs/tags/v1x2x3', false],
  ])('for a grant with %s', (_case, pattern, matches) => {
    const match = matchPublishGrant({bootstrap: bootstrapWith({refs: [pattern]}), claims});

    expect(match.outcome).toBe(matches ? 'matched' : 'unmatched');
  });

  it('matches every ref when the grant lists none', () => {
    const match = matchPublishGrant({bootstrap: bootstrapWith({}), claims});

    expect(match.outcome).toBe('matched');
  });

  it('picks the first namespace whose grant matches', () => {
    const bootstrap = bootstrapWith({namespaces: ['first', 'second']});

    expect(matchPublishGrant({bootstrap, claims})).toMatchObject({
      outcome: 'matched',
      namespace: 'first',
    });
  });
});
