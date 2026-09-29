import type {GithubUserInstallation, GithubUserInstallationPage} from '#api/client.js';

export function githubUserInstallation(id: number): GithubUserInstallation {
  return {
    id,
    account: {login: `account-${id}`, type: 'Organization'},
    repositorySelection: 'all',
  };
}

export function githubUserInstallationPage(
  ids: number[],
  nextCursor: string | null = null,
): GithubUserInstallationPage {
  return {installations: ids.map(githubUserInstallation), nextCursor};
}
