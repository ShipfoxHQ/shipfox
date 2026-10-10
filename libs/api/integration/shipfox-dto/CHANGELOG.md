# @shipfox/api-integration-shipfox-dto

## 34.0.0

### Minor Changes

- 4aad893: Adds machine placement rules for installation provisioning. A policy can now pass `placement.resolve`, and a job that needs a reserved runner label but only matches refused templates fails within one poll with the new `runner_not_allowed` status reason and its notice. The client shows the notice and its action.
- 6c0d6bd: Adds Shipfox run and job lifecycle events for workflow triggers.
- ebe3ac1: Adds the Shipfox lifecycle event names, payload schemas, empty event catalog, and exported built-in integration connection ID contract.
- 2ab4025: Workflows can link to their runs. `run.url` in the run context, `event.run.url` on Shipfox run and job events, and `url` on the `start_workflow_run` output hold the run permalink, built from `CLIENT_BASE_URL`. Replaying a Shipfox event stored without `run.url` fills it in. The `slack-dispatcher` and `report-failed-runs` templates use these links instead of `https://app.shipfox.io/runs/`.

### Patch Changes

- 027e401: Describes the fields of the Shipfox lifecycle event payload schemas.
- Updated dependencies [c4f486b]
- Updated dependencies [4273dad]
- Updated dependencies [e2e561c]
- Updated dependencies [9485c57]
- Updated dependencies [82f2480]
  - @shipfox/api-integration-core-dto@34.0.0
