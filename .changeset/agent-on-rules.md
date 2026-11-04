---
"@shipfox/workflow-document": minor
"@shipfox/api-definitions": minor
"@shipfox/api-definitions-dto": minor
"@shipfox/api-triggers": minor
---

An agent file can claim part of Slack or Linear with `on:` rules, and definition sync stores those claims as agent subscriptions.

- **Agent document:** `on` is a list of rules, each with a `source` and an optional `filter`. A rule has no `event`, `with`, `secrets`, or `config`. `agentRuleSchema` and the `AgentRule` type are exported.
- **Sync:** a rule must name a connection with the interaction capability, and its filter is checked as a boolean condition over `request`, typed from the provider's `requestContextSchema`, and `event`. An invalid rule keeps the agent's last valid version and records the error. A rule on an unknown connection fails with `integration-connection-not-found`, and a filter error has the new code `invalid-agent-rule-filter`.
- **Events:** each agent sync publishes `definitions.agent_rules.resolved` with the rules of every stored agent.
- **Subscriptions:** Triggers owns the new `triggers_agent_subscriptions` table, with project, agent key, source, filter, and the date the binding was first created. A rule that stays keeps its date, and a removed rule or agent removes its subscription.
