---
"@shipfox/api-agent-dto": minor
"@shipfox/api-agent": minor
"@shipfox/api-triggers": minor
"@shipfox/api-triggers-dto": minor
"@shipfox/workflow-document": patch
"@shipfox/client-triggers": patch
---

A new Slack or Linear request goes to the agent whose `on:` rule matches it, with one agent per conversation.

- **Matching:** for a request, Triggers evaluates the agent subscriptions on the event's source, with each filter reading `request` and `event`, and passes the matches to `routeInteraction` as `candidates`. Follow-ups and stops match no rule.
- **Owner:** Agent starts the conversation with the first candidate whose project takes the connection: custom agents before Shippys, and the earliest binding first within each group. Without one, the default Shippy answers, as before. A key that already has a conversation keeps it.
- **Contract:** `routeInteraction` takes an optional `candidates` list and can return the new outcome `matched`, with the winning `subscriptionId` and the `ambiguousSubscriptionIds` of the other candidates.
- **Decisions:** an `agent` decision can now name an agent subscription. The winning rule is recorded as `owner`, the others as the new outcome `ambiguous`, and a rule whose filter fails as `filter-error`. Migration `0008_agent_rule_decisions` relaxes the decisions check constraint.
- **Docs:** the `on` field description and the workflow schema reference describe how requests are routed.
