---
'@shipfox/api-integration-spi': minor
'@shipfox/api-integration-core-dto': minor
'@shipfox/api-integration-core': minor
'@shipfox/api-integration-slack-dto': minor
'@shipfox/api-integration-slack': minor
'@shipfox/client-integrations': minor
---

Prepares Slack for agents. The Slack app now requests `chat:write.customize` and `assistant:write`, and Slack publishes the agent view events `assistant_thread_started`, `app_context_changed`, and `agent_session_stopped` without adding them to the workflow event catalog. A provider can implement `connectionReconnectRequired` to report an active connection that lacks a newer permission. The connections list then returns `reconnect_required`, the connection page asks the user to reconnect, and agents ignore the connection's events until it reconnects. Slack reports this for an installation that lacks a required scope.
