// Raw Gitea push webhook payloads, shaped as Gitea delivers them over the wire
// (the subset the receiver reads). Tests serialize these to build signed request
// bodies; the route parses and validates them with the production Zod schema.
// Field names mirror a real Gitea `push` delivery (ref, after, repository.{name,
// full_name, default_branch, owner.username}).

export interface GiteaPushPayloadOptions {
  owner: string;
  repo: string;
  ref: string;
  defaultBranch: string;
  sha: string;
}

export function giteaPushPayload(options: GiteaPushPayloadOptions) {
  return {
    ref: options.ref,
    after: options.sha,
    repository: {
      name: options.repo,
      full_name: `${options.owner}/${options.repo}`,
      default_branch: options.defaultBranch,
      owner: {username: options.owner},
    },
  };
}
