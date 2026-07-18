# Jira integration

This package owns Jira provider persistence and token storage. The provider is non-functional until ENG-1001 adds the OAuth install flow.

Connect Jira with a dedicated Shipfox service account. Jira 3LO actions are authored by the authorizing account, so events from that account are dropped to prevent agent actions from triggering themselves.
