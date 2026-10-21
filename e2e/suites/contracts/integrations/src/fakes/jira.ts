import {type JiraSeed, startJiraApiMock} from '@shipfox/e2e-driver-jira';
import {
  type ContractFakeAdapter,
  ephemeralEndpoint,
  rejectingSeed,
  requiredField,
  type SandboxFixtures,
} from './shared.js';

/** What the Jira tool adapter needs to act as the connection. */
export interface JiraContractAccess {
  accessToken: string;
}

/** The Jira objects the fixtures describe, with the ids and fields of the sandbox. */
function jiraSeed(fixtures: SandboxFixtures): JiraSeed {
  const read = ({fixtureName, name}: {fixtureName: string; name: string}) =>
    String(
      requiredField({provider: 'jira', fixture: fixtures[fixtureName] ?? {}, fixtureName, name}),
    );
  const projects = ['read_project', 'write_project']
    .filter((fixtureName) => fixtures[fixtureName] !== undefined)
    .map((fixtureName) => ({
      key: read({fixtureName, name: 'key'}),
      id: read({fixtureName, name: 'id'}),
      name: read({fixtureName, name: 'name'}),
    }));
  const issue =
    fixtures.issue === undefined
      ? undefined
      : {
          key: read({fixtureName: 'issue', name: 'key'}),
          id: read({fixtureName: 'issue', name: 'id'}),
          summary: read({fixtureName: 'issue', name: 'summary'}),
        };
  if (fixtures.comment !== undefined && issue === undefined) {
    throw new Error('The jira comment fixture needs an issue fixture.');
  }
  const comment =
    fixtures.comment === undefined || issue === undefined
      ? undefined
      : {
          issueKey: issue.key,
          id: read({fixtureName: 'comment', name: 'id'}),
          body: read({fixtureName: 'comment', name: 'body'}),
        };
  const user =
    fixtures.user === undefined
      ? undefined
      : {
          accountId: read({fixtureName: 'user', name: 'account_id'}),
          displayName: read({fixtureName: 'user', name: 'display_name'}),
        };
  return {
    projects,
    issues: issue === undefined ? [] : [issue],
    comments: comment === undefined ? [] : [comment],
    users: user === undefined ? [] : [user],
  };
}

/**
 * Jira, behind an access token. It seeds the projects, the `issue` fixture and its `comment`, and
 * the `user`, with the ids and fields of the sandbox. The fake serves any Jira site, so no site
 * fixture is needed, and it answers an issue or a query it was not seeded with like Jira does.
 */
export const jiraContractFake: ContractFakeAdapter<JiraContractAccess> = async ({
  uniqueId,
  cleanups,
}) => {
  const accessToken = `jira-access-token-${uniqueId}`;
  const mock = await startJiraApiMock({
    accessToken,
    endpoint: ephemeralEndpoint(),
    rejectUnseeded: true,
  });
  cleanups.push(() => mock.stop());
  return {
    env: {JIRA_API_BASE_URL: mock.endpoint.toString()},
    access: {accessToken},
    seed: (fixtures) => rejectingSeed(() => mock.seed(jiraSeed(fixtures))),
    // The `jira.` prefix keeps a Jira write apart from a write of the same kind on another fake.
    writes: () => mock.writes().map((write) => ({...write, kind: `jira.${write.kind}`})),
  };
};
