---
"@shipfox/actions": minor
---

Tool arguments are typed from the provider tool catalogs. Declare `Aliases` through module augmentation, for example `declare module '@shipfox/actions' { interface Aliases { slack: 'slack' } }`, and `tools.slack.call` then accepts only Slack tool ids and `family.method` names, with their argument types. `download` accepts only file tools. Results stay `unknown`. Without `Aliases`, calls stay untyped.
