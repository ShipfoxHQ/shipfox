---
"@shipfox/client-projects": minor
---

Project settings gain an **Access** section, at `settings/access`. An admin chooses All connections or a list, and limits each listed GitHub or Gitea connection to all its repositories or selected ones. A linked project's config connection and repository show checked and locked. Saving asks for confirmation when it changes the repository jobs check out by default, or when the default project stops answering an interaction connection such as Slack or Linear. A refused save turns the section read-only.
