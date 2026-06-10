// Raw GitHub webhook payloads, shaped exactly as GitHub delivers them over the
// wire. Tests serialize these to build signed request bodies; the route parses
// and validates them with the production Zod schema.

export interface GithubPushPayloadOptions {
  installationId: number;
  repositoryId: number;
  ref: string;
  defaultBranch: string;
  sha: string;
}

export function githubPushPayload(options: GithubPushPayloadOptions) {
  return {
    ref: options.ref,
    after: options.sha,
    repository: {id: options.repositoryId, default_branch: options.defaultBranch},
    installation: {id: options.installationId},
  };
}
