# @shipfox/annotations-dto

## 34.0.0

### Minor Changes

- 10678ba: Deletes a deleted project's run data for good, and keeps late events from recreating it. After a project is deleted, no run, log, annotation, or pending job remains, and a late step termination event creates nothing.

  - **Workflows:** the `PROJECT_DELETED` subscriber records a deletion marker, cancels the project's open runs, and deletes its finished runs with their attempts, jobs, steps, and concurrency claims. A run that is still open waits for the next delivery. Run creation, reruns, and concurrency claims refuse a marked project with the existing `project-deleted` error.
  - **Logs:** the subscriber deletes the project's attempt streams, which cascade to their chunks, with their job accounting and stored objects. Creating an attempt stream, including when a step attempt terminates, is refused for a marked project. The append route answers `project-not-found`, and `appendServerRecords` gains the `project-deleted` known error. A new `logs_attempt_streams_project_idx` index serves the purge.
  - **Annotations:** the subscriber deletes the project's annotations, and annotation writes are refused for a marked project, with `project-not-found` on the annotation route. `replaceOrRemoveAnnotation` gains the `project-deleted` known error, and the failure-annotation subscriber skips it. A new `annotations_project_idx` index serves the purge.
  - **Runners:** the subscriber deletes the project's pending jobs, and queueing a job is refused for a marked project. A running job ends through the cancellation of its run. A new `runners_pending_jobs_project_idx` index serves the purge.
  - **Migrations:** each module adds a `deleted_scopes` table. The three indexes are built in the migration transaction, so they block writes to their table while they build.

## 29.0.0

### Minor Changes

- 8e74f71: Adds read-only Shipfox tools for bounded step logs and paged run annotations.

## 20.3.0

### Minor Changes

- 47f6024: Add bounded paged agent-access tools for project, definition, run, annotation, and trigger-event reads.

## 20.2.0

### Minor Changes

- ff63dcd: Adds the workflow-run annotations endpoint with job, execution, and step ancestry, plus the job-explanations endpoint for failed or skipped jobs without execution rows.

## 19.0.0

### Minor Changes

- 34ebe6a: Expose workspace-scoped workflow execution and annotation read contracts.

### Patch Changes

- @shipfox/inter-module@0.2.3

## 12.3.0

### Minor Changes

- 4b0731e: Adds workflow troubleshooting details, evaluation traces, failure annotations, runner context, step output metadata, and lazy paginated annotation summaries.

## 12.0.0

### Patch Changes

- Updated dependencies [f78740d]
  - @shipfox/inter-module@0.2.3

## 9.0.2

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.
- Updated dependencies [4b85404]
  - @shipfox/inter-module@0.2.2

## 9.0.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [475ce59]
  - @shipfox/inter-module@0.2.1

## 6.0.0

### Minor Changes

- 9cb2442: Moves workflow capability-warning annotations behind the producer-owned inter-module API.

### Patch Changes

- Updated dependencies [81f9544]
  - @shipfox/inter-module@0.2.0

## 5.0.0

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.

## 2.0.0

### Minor Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.

## 0.0.1

### Patch Changes

- 5707d6d: Adds the user-authenticated annotations read route with workspace-scoped run-attempt filtering, DTO conversion, and a continuation cursor.
