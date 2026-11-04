---
"@shipfox/api-workflows": minor
"@shipfox/api-logs": minor
"@shipfox/api-logs-dto": minor
"@shipfox/annotations": minor
"@shipfox/annotations-dto": minor
"@shipfox/api-runners": minor
---

Deletes a deleted project's run data for good, and keeps late events from recreating it. After a project is deleted, no run, log, annotation, or pending job remains, and a late step termination event creates nothing.

- **Workflows:** the `PROJECT_DELETED` subscriber records a deletion marker, cancels the project's open runs, and deletes its finished runs with their attempts, jobs, steps, and concurrency claims. A run that is still open waits for the next delivery. Run creation, reruns, and concurrency claims refuse a marked project with the existing `project-deleted` error.
- **Logs:** the subscriber deletes the project's attempt streams, which cascade to their chunks, with their job accounting and stored objects. Creating an attempt stream, including when a step attempt terminates, is refused for a marked project. The append route answers `project-not-found`, and `appendServerRecords` gains the `project-deleted` known error. A new `logs_attempt_streams_project_idx` index serves the purge.
- **Annotations:** the subscriber deletes the project's annotations, and annotation writes are refused for a marked project, with `project-not-found` on the annotation route. `replaceOrRemoveAnnotation` gains the `project-deleted` known error, and the failure-annotation subscriber skips it. A new `annotations_project_idx` index serves the purge.
- **Runners:** the subscriber deletes the project's pending jobs, and queueing a job is refused for a marked project. A running job ends through the cancellation of its run. A new `runners_pending_jobs_project_idx` index serves the purge.
- **Migrations:** each module adds a `deleted_scopes` table. The three indexes are built in the migration transaction, so they block writes to their table while they build.
